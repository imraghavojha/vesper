import { useCallback, useEffect, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import type { AgendaEvent, CalendarSnapshot } from "../shared/calendar.js";
import type { useSync } from "./use-sync.js";
import "./calendar-panel.css";

type Api = ReturnType<typeof useSync>["api"];

const message = (cause: unknown) =>
  cause instanceof TRPCClientError
    ? cause.message
    : "Vesper couldn’t reach the host. Check the connection and try again.";
const dayKey = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
const time = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

// Lists each event under every local date it covers in the next seven days.
// Declined, free and all-day events never conflict.
function agenda(events: AgendaEvent[]) {
  const now = new Date();
  // Sorted by start, an event can only overlap later events that begin before it ends.
  const timed = events
    .filter((event) => event.busy && !event.allDay)
    .sort((a, b) => a.start.localeCompare(b.start));
  const conflicts = new Set<AgendaEvent>();
  timed.forEach((event, index) => {
    for (
      let next = index + 1;
      next < timed.length && timed[next]!.start < event.end;
      next++
    )
      if (
        event.start < timed[next]!.end &&
        (timed[next]!.icalUid === null ||
          timed[next]!.icalUid !== event.icalUid)
      )
        conflicts.add(event).add(timed[next]!);
  });
  const marked = events.map((event) => ({
    ...event,
    conflict: conflicts.has(event),
  }));
  return Array.from({ length: 7 }, (_, offset) => {
    const date = (days: number) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
    const day = date(offset);
    const from = offset ? day : now;
    const key = dayKey(day);
    return [
      day,
      marked.filter((event) =>
        event.allDay
          ? event.start <= key && event.end > key
          : new Date(event.start) < date(offset + 1) &&
            new Date(event.end) > from,
      ),
    ] as const;
  }).filter(([, list]) => list.length);
}

export function CalendarPanel({
  api,
  online,
  hostUrl,
  refreshHint,
}: {
  api: Api;
  online: boolean;
  hostUrl: string;
  refreshHint: number | undefined;
}) {
  const [snapshot, setSnapshot] = useState<CalendarSnapshot | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [confirming, setConfirming] = useState("");

  const load = useCallback(async () => {
    try {
      setSnapshot(await api.calendar.query());
    } catch (cause) {
      setError(message(cause));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load, refreshHint]);

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy("");
    }
  }
  const connect = () =>
    run("connect", async () => {
      const { authUrl } = await api.connectGoogle.mutate({ hostUrl });
      setAuthUrl(authUrl);
      window.open(authUrl, "_blank", "noopener");
    });

  const names = new Map(
    snapshot?.accounts.flatMap((account) =>
      account.calendars.map((calendar) => [
        account.id + "\n" + calendar.id,
        snapshot.accounts.length > 1
          ? `${calendar.summary} · ${account.email}`
          : calendar.summary,
      ]),
    ),
  );
  const disabled = !online || !!busy;
  const days = agenda(snapshot?.events ?? []);

  return (
    <div className="calendar-panel">
      {error && <p className="panel-error">{error}</p>}
      {notice && <p className="settings-muted">{notice}</p>}
      <h4 className="settings-group-label">Google Calendar</h4>
      <div className="settings-card">
        {snapshot && !snapshot.configured ? (
          <p className="calendar-empty">
            Google isn’t set up on this host. The host operator needs to add a
            Google OAuth client file before accounts can connect.
          </p>
        ) : (
          <ul className="calendar-list">
            {snapshot?.accounts.map((account) => (
              <li key={account.id} className="calendar-row">
                <div className="calendar-row__main">
                  <span className="calendar-row__title">
                    <span className="calendar-row__name" title={account.email}>
                      {account.email}
                    </span>
                    <span
                      className={`calendar-tag calendar-tag--${account.status}`}
                    >
                      {account.syncing || busy === account.id
                        ? "Syncing"
                        : account.status === "connected"
                          ? "Connected"
                          : account.status === "reconnect"
                            ? "Reconnect needed"
                            : "Sync failed"}
                    </span>
                  </span>
                  <span className="calendar-row__meta">
                    {account.message ??
                      (account.lastSyncAt
                        ? `${account.calendars.length} ${account.calendars.length === 1 ? "calendar" : "calendars"} · Read-only · Synced ${new Date(account.lastSyncAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`
                        : "Read-only · Not synced yet")}
                  </span>
                </div>
                <div className="calendar-row__actions">
                  {account.status === "reconnect" ? (
                    <button
                      className="pill-button"
                      disabled={disabled}
                      onClick={() => void connect()}
                    >
                      Reconnect
                    </button>
                  ) : (
                    <button
                      className="pill-button"
                      disabled={disabled}
                      onClick={() =>
                        void run(account.id, async () => {
                          setSnapshot(
                            await api.syncGoogle.mutate({
                              accountId: account.id,
                            }),
                          );
                        })
                      }
                    >
                      Sync now
                    </button>
                  )}
                  <button
                    className="pill-button"
                    disabled={disabled}
                    onClick={() =>
                      confirming === account.id
                        ? void run("disconnect", async () => {
                            setConfirming("");
                            const result = await api.disconnectGoogle.mutate({
                              accountId: account.id,
                            });
                            setNotice(
                              result.remoteRevoked
                                ? `${account.email} was disconnected and its synced events were deleted.`
                                : `${account.email} was removed from Vesper, but Google didn’t confirm revoking access. Remove Vesper from your Google Account’s third-party access page.`,
                            );
                            await load();
                          })
                        : setConfirming(account.id)
                    }
                  >
                    {confirming === account.id
                      ? "Confirm disconnect"
                      : "Disconnect"}
                  </button>
                </div>
              </li>
            ))}
            <li className="calendar-row">
              <div className="calendar-row__main">
                <span className="calendar-row__title">
                  Add a Google account
                </span>
                <span className="calendar-row__meta">
                  Vesper reads your calendars. It can’t create or change events.
                </span>
              </div>
              <button
                className="pill-button"
                disabled={disabled || !snapshot}
                onClick={() => void connect()}
              >
                Connect
              </button>
            </li>
          </ul>
        )}
      </div>
      {authUrl && (
        <p className="settings-footnote">
          Finish signing in with Google in your browser. This list updates when
          it’s done.{" "}
          <a href={authUrl} target="_blank" rel="noopener noreferrer">
            Open Google sign-in
          </a>
        </p>
      )}
      {!!snapshot?.accounts.length && (
        <>
          <h4 className="settings-group-label">Next 7 days</h4>
          <div className="settings-card">
            {days.length ? (
              days.map(([day, events]) => (
                <section key={day.toISOString()} className="calendar-day">
                  <h5>
                    {day.toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}
                  </h5>
                  <ul className="calendar-list">
                    {events.map((event) => (
                      <li
                        key={`${event.accountId}\n${event.calendarId}\n${event.id}`}
                        className="calendar-event"
                      >
                        <span className="calendar-event__time">
                          {event.allDay
                            ? "All day"
                            : `${time(event.start)} – ${time(event.end)}`}
                        </span>
                        <span className="calendar-row__main">
                          <span className="calendar-row__title">
                            {event.summary}
                            {event.conflict && (
                              <span className="calendar-tag calendar-tag--error">
                                Overlaps
                              </span>
                            )}
                          </span>
                          <span className="calendar-row__meta">
                            {names.get(
                              event.accountId + "\n" + event.calendarId,
                            )}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <p className="calendar-empty">No events in the next 7 days.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
