import type { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { TRPCError } from "@trpc/server";
import { transaction } from "./transaction.js";
import { VaultError, type Vault } from "./vault/service.js";
import type { CalendarSnapshot, GoogleAccount } from "../shared/calendar.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ORIGIN = "https://oauth2.googleapis.com";
const TOKEN_URL = TOKEN_ORIGIN + "/token";
const REVOKE_URL = TOKEN_ORIGIN + "/revoke";
const API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const MAX_PAGES = 40;
const DAY = 86_400_000;

type Options = {
  database: DatabaseSync;
  vault: Vault;
  clientFile: string;
  appendChange(id: string, revision: number): unknown;
  notify(): void;
};
type AccountRow = {
  id: string;
  subject: string;
  email: string;
  vaultEntryId: string;
  vaultRevision: number;
  status: GoogleAccount["status"];
  message: string | null;
  lastSyncAt: string | null;
  revision: number;
};
type Problem = { status: "reconnect" | "error"; message: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

class GoogleError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`Google request failed (${status} ${reason})`);
  }
}

const base64url = (value: Buffer) => value.toString("base64url");
const form = (values: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values),
});

export function createGoogleCalendar(options: Options) {
  const db = options.database;
  const schema = db.prepare("SELECT version FROM schema_version").get() as {
    version: number;
  };
  if (schema.version === 4)
    transaction(db, () => {
      db.exec(`
        CREATE TABLE google_accounts (
          id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
          vaultEntryId TEXT NOT NULL, vaultRevision INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('connected','reconnect','error')),
          message TEXT, lastSyncAt TEXT, revision INTEGER NOT NULL, createdAt TEXT NOT NULL
        );
        CREATE TABLE google_calendars (
          accountId TEXT NOT NULL REFERENCES google_accounts(id) ON DELETE CASCADE,
          id TEXT NOT NULL, summary TEXT NOT NULL, isPrimary INTEGER NOT NULL, syncToken TEXT,
          PRIMARY KEY(accountId, id)
        );
        CREATE TABLE google_events (
          accountId TEXT NOT NULL, calendarId TEXT NOT NULL, id TEXT NOT NULL,
          icalUid TEXT, summary TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
          allDay INTEGER NOT NULL, busy INTEGER NOT NULL,
          PRIMARY KEY(accountId, calendarId, id),
          FOREIGN KEY(accountId, calendarId) REFERENCES google_calendars(accountId, id) ON DELETE CASCADE
        );
        CREATE INDEX google_events_start ON google_events(start);
        UPDATE schema_version SET version=5;
      `);
    });

  // Read on use so an operator can add the file without restarting the host.
  function client() {
    try {
      const file = JSON.parse(readFileSync(options.clientFile, "utf8")) as Json;
      const value = file.installed ?? file.web;
      if (
        typeof value?.client_id === "string" &&
        typeof value.client_secret === "string"
      )
        return {
          id: value.client_id as string,
          secret: value.client_secret as string,
        };
    } catch {
      /* Missing or malformed configuration means Google is unavailable. */
    }
    return null;
  }
  async function call(url: string, init: RequestInit = {}): Promise<Json> {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok)
      throw new GoogleError(
        response.status,
        String(
          typeof body.error === "string"
            ? body.error
            : (body.error?.errors?.[0]?.reason ?? ""),
        ),
      );
    return body;
  }
  function row(id: string) {
    const account = db
      .prepare("SELECT * FROM google_accounts WHERE id=?")
      .get(id) as AccountRow | undefined;
    if (!account)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Google account not found.",
      });
    return account;
  }
  const scope = (account: AccountRow) => ({
    id: account.vaultEntryId,
    accountId: account.email,
    origin: TOKEN_ORIGIN,
    expectedRevision: account.vaultRevision,
  });
  function forget(entryId: string) {
    try {
      const entry = options.vault
        .snapshot()
        .entries.find((item) => item.id === entryId);
      if (entry)
        options.vault.remove({
          id: entry.id,
          expectedRevision: entry.revision,
        });
    } catch {
      /* A locked or unavailable vault keeps the entry; Secure Store still lists it. */
    }
  }
  function update(id: string, problem: Problem | null) {
    transaction(db, () => {
      const result = (
        problem
          ? db
              .prepare(
                "UPDATE google_accounts SET status=?,message=?,revision=revision+1 WHERE id=? RETURNING revision",
              )
              .get(problem.status, problem.message, id)
          : db
              .prepare(
                "UPDATE google_accounts SET status='connected',message=NULL,lastSyncAt=?,revision=revision+1 WHERE id=? RETURNING revision",
              )
              .get(new Date().toISOString(), id)
      ) as { revision: number } | undefined;
      if (result) options.appendChange(id, result.revision);
    });
    options.notify();
  }

  // Access tokens live only in memory; the refresh token stays in the vault.
  const tokens = new Map<
    string,
    { entry: string; value: string; expiresAt: number }
  >();
  async function accessToken(account: AccountRow) {
    const cached = tokens.get(account.id);
    if (cached?.entry === account.vaultEntryId && cached.expiresAt > Date.now())
      return cached.value;
    const config = client();
    if (!config) throw new GoogleError(0, "notConfigured");
    let response: { status: number; body: Json } | undefined;
    await options.vault.withSecret(scope(account), async (secret) => {
      const result = await fetch(TOKEN_URL, {
        ...form({
          grant_type: "refresh_token",
          refresh_token: secret.toString("utf8"),
          client_id: config.id,
          client_secret: config.secret,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      response = {
        status: result.status,
        body: (await result.json().catch(() => ({}))) as Json,
      };
    });
    if (
      !response ||
      response.status !== 200 ||
      typeof response.body.access_token !== "string"
    )
      throw new GoogleError(
        response?.status ?? 0,
        String(response?.body.error ?? ""),
      );
    tokens.set(account.id, {
      entry: account.vaultEntryId,
      value: response.body.access_token,
      expiresAt: Date.now() + (Number(response.body.expires_in) - 60) * 1000,
    });
    return response.body.access_token as string;
  }
  async function pages(
    url: string,
    params: Record<string, string>,
    token: string,
  ) {
    const items: Json[] = [];
    let pageToken = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const target = new URL(url);
      target.search = new URLSearchParams({
        ...params,
        maxResults: "250",
        ...(pageToken ? { pageToken } : {}),
      }).toString();
      const body = await call(target.href, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (Array.isArray(body.items)) items.push(...body.items);
      if (typeof body.nextPageToken !== "string")
        return {
          items,
          nextSyncToken: body.nextSyncToken as string | undefined,
        };
      pageToken = body.nextPageToken;
    }
    throw new GoogleError(0, "tooManyResults");
  }
  async function syncCalendar(
    accountId: string,
    calendarId: string,
    token: string,
  ) {
    const saved = db
      .prepare(
        "SELECT syncToken FROM google_calendars WHERE accountId=? AND id=?",
      )
      .get(accountId, calendarId) as { syncToken: string | null } | undefined;
    let syncToken = saved?.syncToken ?? null;
    const url = `${API}/calendars/${encodeURIComponent(calendarId)}/events`;
    // A full sync starts a week back; later syncs fetch only changes.
    const full = () =>
      pages(
        url,
        {
          singleEvents: "true",
          timeMin: new Date(Date.now() - 7 * DAY).toISOString(),
        },
        token,
      );
    let result;
    try {
      result = syncToken
        ? await pages(url, { singleEvents: "true", syncToken }, token)
        : await full();
    } catch (error) {
      if (!(error instanceof GoogleError && error.status === 410 && syncToken))
        throw error;
      syncToken = null;
      result = await full();
    }
    transaction(db, () => {
      if (!syncToken)
        db.prepare(
          "DELETE FROM google_events WHERE accountId=? AND calendarId=?",
        ).run(accountId, calendarId);
      const remove = db.prepare(
        "DELETE FROM google_events WHERE accountId=? AND calendarId=? AND id=?",
      );
      const upsert = db.prepare(
        "INSERT OR REPLACE INTO google_events VALUES (?,?,?,?,?,?,?,?,?)",
      );
      for (const item of result.items) {
        if (typeof item.id !== "string") continue;
        const start = item.start?.dateTime ?? item.start?.date;
        const end = item.end?.dateTime ?? item.end?.date;
        if (
          item.status === "cancelled" ||
          typeof start !== "string" ||
          typeof end !== "string"
        ) {
          remove.run(accountId, calendarId, item.id);
          continue;
        }
        const allDay = !item.start.dateTime;
        const declined = Array.isArray(item.attendees)
          ? item.attendees.some(
              (a: Json) => a.self && a.responseStatus === "declined",
            )
          : false;
        upsert.run(
          accountId,
          calendarId,
          item.id,
          typeof item.iCalUID === "string" ? item.iCalUID : null,
          typeof item.summary === "string" && item.summary
            ? item.summary
            : "(No title)",
          allDay ? start : new Date(start).toISOString(),
          allDay ? end : new Date(end).toISOString(),
          allDay ? 1 : 0,
          item.transparency !== "transparent" && !declined ? 1 : 0,
        );
      }
      db.prepare(
        "UPDATE google_calendars SET syncToken=? WHERE accountId=? AND id=?",
      ).run(result.nextSyncToken ?? null, accountId, calendarId);
    });
  }
  function problem(error: unknown): Problem {
    if (error instanceof VaultError) {
      if (error.code === "USE_FAILED")
        return {
          status: "error",
          message: "Google couldn’t be reached. Try again.",
        };
      if (
        ["NOT_FOUND", "REVOKED", "CONFLICT", "SCOPE_MISMATCH"].includes(
          error.code,
        )
      )
        return {
          status: "reconnect",
          message:
            "Saved Google access was changed or removed in Secure Store. Reconnect.",
        };
      return { status: "error", message: error.message };
    }
    if (error instanceof GoogleError) {
      if (error.reason === "notConfigured")
        return {
          status: "error",
          message: "Google isn’t set up on this host.",
        };
      if (
        error.reason === "invalid_grant" ||
        (error.status === 401 && error.reason !== "invalid_client")
      )
        return {
          status: "reconnect",
          message: "Google access was revoked or expired. Reconnect.",
        };
      return {
        status: "error",
        message: `Google Calendar refused the request (${[error.status || "", error.reason].filter(Boolean).join(", ")}).`,
      };
    }
    return {
      status: "error",
      message: "Google couldn’t be reached. Try again.",
    };
  }

  const running = new Map<string, Promise<void>>();
  function sync(id: string): Promise<void> {
    const account = row(id);
    const existing = running.get(id);
    if (existing) return existing;
    const work = (async () => {
      try {
        const token = await accessToken(account);
        const list = await pages(`${API}/users/me/calendarList`, {}, token);
        const calendars = list.items
          .filter((item) => typeof item.id === "string")
          .map((item) => ({
            id: item.id as string,
            summary: String(item.summaryOverride ?? item.summary ?? item.id),
            primary: item.primary === true,
          }));
        transaction(db, () => {
          const keep = new Set(calendars.map((calendar) => calendar.id));
          const saved = db
            .prepare("SELECT id FROM google_calendars WHERE accountId=?")
            .all(id) as Array<{ id: string }>;
          for (const calendar of saved)
            if (!keep.has(calendar.id))
              db.prepare(
                "DELETE FROM google_calendars WHERE accountId=? AND id=?",
              ).run(id, calendar.id);
          const upsert = db.prepare(
            "INSERT INTO google_calendars(accountId,id,summary,isPrimary) VALUES (?,?,?,?) ON CONFLICT(accountId,id) DO UPDATE SET summary=excluded.summary,isPrimary=excluded.isPrimary",
          );
          for (const calendar of calendars)
            upsert.run(
              id,
              calendar.id,
              calendar.summary,
              calendar.primary ? 1 : 0,
            );
        });
        for (const calendar of calendars)
          await syncCalendar(id, calendar.id, token);
        update(id, null);
      } catch (error) {
        if (error instanceof GoogleError && error.status === 401)
          tokens.delete(id);
        update(id, problem(error));
      }
    })().finally(() => running.delete(id));
    running.set(id, work);
    return work;
  }

  const flows = new Map<
    string,
    { verifier: string; redirectUri: string; expiresAt: number }
  >();
  return {
    snapshot(): CalendarSnapshot {
      const accounts = db
        .prepare("SELECT * FROM google_accounts ORDER BY createdAt, id")
        .all() as AccountRow[];
      const calendars = db
        .prepare(
          "SELECT * FROM google_calendars ORDER BY isPrimary DESC, summary",
        )
        .all() as Array<{
        accountId: string;
        id: string;
        summary: string;
        isPrimary: number;
      }>;
      const events = db
        .prepare(
          "SELECT * FROM google_events WHERE end > ? AND start < ? ORDER BY start, summary LIMIT 300",
        )
        .all(
          new Date(Date.now() - DAY).toISOString(),
          new Date(Date.now() + 8 * DAY).toISOString(),
        ) as Json[];
      return {
        configured: client() !== null,
        accounts: accounts.map((account) => ({
          id: account.id,
          email: account.email,
          status: account.status,
          message: account.message,
          lastSyncAt: account.lastSyncAt,
          syncing: running.has(account.id),
          calendars: calendars
            .filter((calendar) => calendar.accountId === account.id)
            .map((calendar) => ({
              id: calendar.id,
              summary: calendar.summary,
              primary: calendar.isPrimary === 1,
            })),
        })),
        events: events.map((event) => ({
          ...event,
          allDay: event.allDay === 1,
          busy: event.busy === 1,
        })),
      };
    },
    // Starts the external-browser OAuth flow. The redirect returns to this host.
    connect(hostUrl: string) {
      const config = client();
      if (!config)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Google isn’t set up on this host. Add a Google OAuth client file first.",
        });
      let vaultState;
      try {
        vaultState = options.vault.snapshot().status.state;
      } catch {
        vaultState = "unavailable";
      }
      if (vaultState !== "ready")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Set up and unlock Secure Store before connecting Google.",
        });
      const now = Date.now();
      for (const [key, flow] of flows)
        if (flow.expiresAt < now) flows.delete(key);
      if (flows.size >= 20)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Finish an open Google sign-in or wait ten minutes.",
        });
      const state = base64url(randomBytes(32));
      const verifier = base64url(randomBytes(32));
      const redirectUri = new URL(
        "/oauth/google/callback",
        new URL(hostUrl).origin,
      ).href;
      flows.set(state, { verifier, redirectUri, expiresAt: now + 10 * 60_000 });
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: config.id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: `openid email ${SCOPE}`,
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: base64url(
          createHash("sha256").update(verifier).digest(),
        ),
        code_challenge_method: "S256",
      }).toString();
      return { authUrl: url.href };
    },
    // Plain-text result for the browser tab. Never echoes request input.
    async callback(url: URL): Promise<{ status: number; text: string }> {
      const state = url.searchParams.get("state") ?? "";
      const flow = flows.get(state);
      flows.delete(state);
      if (!flow || flow.expiresAt < Date.now())
        return {
          status: 400,
          text: "This Google sign-in expired or was already used. Start again from Vesper.",
        };
      const code = url.searchParams.get("code");
      const config = client();
      if (!code || !config)
        return {
          status: 400,
          text: "Google access wasn’t granted. You can close this tab.",
        };
      let token: Json;
      let claims: Json;
      try {
        token = await call(
          TOKEN_URL,
          form({
            code,
            client_id: config.id,
            client_secret: config.secret,
            redirect_uri: flow.redirectUri,
            grant_type: "authorization_code",
            code_verifier: flow.verifier,
          }),
        );
        // Received directly from Google's token endpoint over TLS.
        claims = JSON.parse(
          Buffer.from(
            String(token.id_token).split(".")[1] ?? "",
            "base64url",
          ).toString("utf8"),
        );
      } catch {
        return {
          status: 502,
          text: "Google sign-in couldn’t be completed. Start again from Vesper.",
        };
      }
      if (
        !String(token.scope ?? "")
          .split(" ")
          .includes(SCOPE)
      )
        return {
          status: 400,
          text: "Calendar access wasn’t granted. Start again from Vesper and allow access to your calendars.",
        };
      if (
        typeof token.refresh_token !== "string" ||
        typeof claims?.sub !== "string" ||
        typeof claims.email !== "string"
      )
        return {
          status: 502,
          text: "Google didn’t return lasting access. Start again from Vesper.",
        };
      const email = claims.email as string;
      let entry;
      try {
        entry = options.vault.put({
          id: randomUUID(),
          expectedRevision: 0,
          kind: "oauth",
          label: "Google Calendar",
          accountId: email,
          origins: [TOKEN_ORIGIN],
          secret: token.refresh_token,
        });
      } catch (error) {
        return {
          status: 409,
          text: `Secure Store couldn’t save Google access. ${error instanceof VaultError ? error.message : ""}`.trim(),
        };
      }
      const { id, previous } = transaction(db, () => {
        const prior = db
          .prepare("SELECT * FROM google_accounts WHERE subject=?")
          .get(claims.sub) as AccountRow | undefined;
        const id = prior?.id ?? randomUUID();
        if (prior)
          db.prepare(
            "UPDATE google_accounts SET email=?,vaultEntryId=?,vaultRevision=?,status='connected',message=NULL,revision=revision+1 WHERE id=?",
          ).run(email, entry.id, entry.revision, id);
        else
          db.prepare(
            "INSERT INTO google_accounts VALUES (?,?,?,?,?,'connected',NULL,NULL,1,?)",
          ).run(
            id,
            claims.sub,
            email,
            entry.id,
            entry.revision,
            new Date().toISOString(),
          );
        options.appendChange(id, (prior?.revision ?? 0) + 1);
        return { id, previous: prior?.vaultEntryId };
      });
      options.notify();
      if (previous) forget(previous);
      tokens.delete(id);
      void sync(id).catch(() => {});
      return {
        status: 200,
        text: `Google Calendar is connected for ${email}. You can close this tab and return to Vesper.`,
      };
    },
    sync,
    async disconnect(id: string) {
      const account = row(id);
      let remoteRevoked = false;
      try {
        await options.vault.withSecret(scope(account), async (secret) => {
          const response = await fetch(REVOKE_URL, {
            ...form({ token: secret.toString("utf8") }),
            signal: AbortSignal.timeout(20_000),
          });
          remoteRevoked = response.ok;
        });
      } catch {
        /* Local removal continues; the result reports that Google wasn't confirmed. */
      }
      forget(account.vaultEntryId);
      tokens.delete(id);
      transaction(db, () => {
        if (
          db.prepare("DELETE FROM google_accounts WHERE id=?").run(id).changes
        )
          options.appendChange(id, account.revision + 1);
      });
      options.notify();
      return { remoteRevoked };
    },
  };
}
export type GoogleCalendar = ReturnType<typeof createGoogleCalendar>;
