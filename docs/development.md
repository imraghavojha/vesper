# Development

Vesper can open a local workspace on a Mac or connect to an independent host. Android is optional for Mac use. The application saves main and side conversations, shared appearance and private unsent drafts, alongside workspace identity and device connections. An explicitly selected eligible Claude account can provide chat replies. Mac quick access and on-device voice draft controls are available as described below; read-only Google Calendar sync is available; other connectors, schedules, other harnesses and Android are still being built. IMR-6 remains open for its remaining acceptance.

## Run the Mac app

Use Node 24.21.0 from `.nvmrc` and the checked-in npm lockfile.

```sh
nvm install
nvm use
npm ci
npm run build
npm run build:native
npm run desktop
```

No separate server command is needed. The bundled first-run screen offers **Start on this Mac** and **Connect to existing host**. Starting locally creates or reopens the Mac's private workspace. It launches the backend in a separate Electron utility process and pairs the desktop privately. Device tokens remain in operating-system-backed encrypted storage. A phone is not required.

Build a local application bundle with `npm run package:mac`. This command must pass the required checks and a fresh production build before it assembles the app, so a failed check cannot silently package an older build. Open `release/Vesper-darwin-arm64/Vesper.app` on Apple Silicon, or the `x64` directory on an Intel Mac. Copy that app to your Applications directory to use it without Node, npm or a terminal. The package contains only application code and production dependencies; no workspace data or browser profiles are copied from the checkout. These local builds are unsigned and not notarized. Public signed installers and updates remain release work.

The Mac's application data lives in `~/Library/Application Support/Vesper`. Its managed backend uses the `local-host` subdirectory. `VESPER_DESKTOP_DATA_DIR` selects an isolated application directory for development or verification. Never point two test applications at one directory.

Local mode listens only on loopback. The app saves the selected port and reuses it on relaunch. If another process occupies that port, Vesper launches its own worker on a fresh port, verifies the workspace identity and updates its encrypted connection. It never treats an unrelated existing listener as its host. Quitting the application stops the local backend. Closing the window on Mac leaves the app running. Turning off the Mac stops local work. The first slice does not run scheduled work yet.

A worker crash allows at most two automatic restart attempts per app lifetime. Existing device tokens are reused. Revoked tokens stay revoked. If local access was removed or forgotten, opening existing local data asks the Mac owner to confirm Restore access before privately creating a replacement device. This is host-owner administration through the trusted bundled app and the OS-owned private profile, equivalent in authority to the local recovery command. It is not available to remote clients or ordinary revoked tokens; revocation does not remove the host administrator's filesystem authority. After the restart budget is exhausted, the displayed Try again action starts the owned local worker with the existing saved token and workspace identity. It never creates a new device or restores a revoked token. Remote-host retry only refreshes the connection. No restart or connection check invokes a model.

## Connect to an independent host

The standalone backend remains deployable on ordinary Node 24.21.0. Run `npm run build`, then `npm start`. It serves the built web client on `http://127.0.0.1:4317` by default. For web development, `npm run dev:server` and `npm run dev:web` use ports 4317 and 5177. The Mac application uses its bundled renderer, not Vite or an externally hosted page.

Choose **Connect to existing host** in the Mac app and enter that host's address and pairing code. Remote hosts require HTTPS. An independent always-on host can stay available while the Mac is off. The current loopback-only local mode is for this Mac; use an independently reachable host for clients on other devices.

The host creates `.vesper/workspace.sqlite` and an `initialized` marker. Keep both in backups. The marker prevents a missing database from silently becoming a new workspace. `VESPER_DATA_DIR` selects another private directory. `VESPER_PORT`, `VESPER_BIND`, `VESPER_HOST_LABEL` and comma-separated `VESPER_ALLOWED_ORIGINS` configure listening and browser access. Origins must match exactly, without a trailing slash. Include `vesper://app` for the installed desktop and the host's HTTPS origin for its browser client.

## Runtime and SQLite

The shared encrypted vault and its operator backup/recovery workflow are documented in [vault operations](vault.md). Secure Store values belong to the host, not the device's `safeStorage` connection/draft files. Its raw key file stays outside the database directory and is excluded from database backups.

Electron 44.4.5 and the independently hosted Node 24.21.0 both include Node's built-in SQLite 3.53.4. Vesper uses the common `node:sqlite` API, so the Mac app does not bundle a second Node runtime or rebuild a native SQLite addon for Electron's different ABI. Existing workspace databases retain their schema, IDs and device credentials.

Node 24.21 documents `node:sqlite` as stability 1.2, release candidate, not fully stable. Keep Node and Electron pinned and verify upgrades against both runtimes. The application uses the small synchronous prepare/get/all/run API and explicit `BEGIN IMMEDIATE`, `COMMIT` and `ROLLBACK` transactions. It does not use changesets or a second synchronization database. See the [pinned Node SQLite documentation](https://raw.githubusercontent.com/nodejs/node/v24.21.0/doc/api/sqlite.md) and [Electron utility-process API](https://www.electronjs.org/docs/latest/api/utility-process).

## Conversations, synchronization and drafts

The first conversation update migrates the workspace database from schema 1 to schema 2 in a transaction. Workspace IDs, device tokens, revocation and pairing state remain intact. Existing workspace-only clients can keep using their endpoints. A new client connected to an older host explains that the host needs the conversation update. Back up before upgrading; an older backend must not be pointed at the upgraded schema.

The workspace contains one main conversation, named side chats, user-authored messages and shared Light/Dark/System appearance. A message is saved to the host only on an explicit send or retry. There is no connected agent, fabricated assistant reply, typing simulation or automatically queued provider task. Messages are plain text in this slice, limited to 10,000 characters. History pages contain at most 100 messages.

Every new conversation/settings/message mutation carries a workspace-global request ID. One transaction writes the domain change, its ordered change record and its receipt. Repeating the same device, operation and normalized payload returns the original result. Reusing the ID with another issuer or payload conflicts. Conversation-name and appearance changes include an expected revision and reject stale edits. Mutation receipts persist separately from the bounded change history. Within an open client, uncertain side-chat creation keeps its original request ID and name across view switches. The name stays locked until a matching receipt resolves the outcome, and only an explicit retry repeats that same creation. A readonly receipt check never creates another chat.

WebSockets at `/sync` provide small authenticated change notices. Tokens travel in the first authentication frame, never URL query strings. HTTP replays ordered changes from the client's cursor, or returns a reset instruction when history is missing. The client then uses a consistent data snapshot and cursor. `VESPER_CHANGE_RETENTION` keeps 1,000 records by default and accepts 10 through 100,000. Replay pages are bounded at 200 changes. Confirmed invalid/revoked authentication closes the stream with code 4001; protocol errors and handshake deadlines do not erase saved credentials. Transport reconnects continue with backoff capped at 30 seconds; focus, visibility and network-online events wake a closed socket immediately. The failure count resets only after a successful state read. Authentication, workspace-identity and unsupported-host errors remain terminal. These transport reads invoke no model and do not change the separate two-attempt worker-crash budget.

Mac drafts are encrypted with `safeStorage` under the private application profile's `drafts` directory. Browser drafts remain in tab session storage. Each draft belongs to one workspace and conversation; the native bridge also checks the active workspace. The encrypted store holds at most 50 drafts and 2 MiB. Corrupt, oversized, symlinked or missing acknowledged files fail without overwriting their contents. There is no plaintext Mac fallback.

The composer reports Saving, Saved or a storage error. Saved appears only after the newest queued local write is acknowledged. Writes are serialized by workspace/conversation across view lifetimes, and a replacement view waits for queued writes before loading. It rereads persistence before reporting a cached draft as saved; missing, changed or unreadable storage keeps the cached text explicitly unsaved. If the latest write fails, its text remains in memory as explicitly unsaved instead of reverting to older disk content; Retry saving draft performs a local write only. A pending send retains its exact request ID and text locally. Reconnecting checks the receipt without resending; an authorized re-paired device can read that workspace's receipt. The client verifies both operation and exact payload hash before clearing its pending draft. A retry is always an explicit action using the same request ID. Local draft text is not sent merely by opening, switching conversations, reconnecting or restarting the app.

The chat layout uses the inspected Muse rail/sidebar/composer proportions where known, with original Vesper branding and system fonts. The source reference's screenshots and motion remain incomplete, so this is not a pixel or animation parity claim. Goals, approvals, reminders and provider streaming can later use the same authoritative database and change log; those domains are not fabricated here.

## Pairing and recovery

An independently started host writes a random, one-use code to its private `pairing-code` file. Enter it in the client and name the device. Codes expire in ten minutes. A connected client can generate another code from the devices panel. Codes grant full access to this single-owner workspace.

A host operator can run `npm run pairing-code`, or `node dist/server/pairing.js` with compiled files, using the same `VESPER_DATA_DIR` as the host. This recovers a lost connection without resetting the database or revoking existing devices. Recovery atomically publishes a private file while holding the SQLite write transaction. Subsequent device revocation still cancels the code normally.

Pairing atomically consumes its code and creates a device. Only token/code hashes are stored in SQLite. Revocation invalidates subsequent requests and cancels every unused pairing code. Repeating an already completed revocation preserves codes created afterwards. Clients pin workspace IDs and refuse a different workspace at the same address. A saved local connection also supplies its expected workspace ID before startup. Missing local data, including loss of the entire local-host directory, requires restoration instead of silently creating a replacement database. Renames reject stale revisions. Workspace/device status refreshes every three seconds while that panel is visible. Conversations and shared appearance use authenticated change notifications and cursor recovery.

An upgrade from the first Mac preview migrates its encrypted connection without changing the token, endpoint or pinned workspace. Legacy records are accepted only when the old HTTP(S) renderer origin equals the validated endpoint, or equals the exact former built-in development origin `http://127.0.0.1:5177`. They become remote connections and are atomically saved under the new renderer identity. Unknown and opaque origins remain rejected.

The Mac renderer loads only bundled `vesper://app` resources. Its IPC guards check the exact scheme and `app` authority, not Node's opaque `URL.origin` value. Only the trusted top-level renderer can access the narrow connection and local-host bridge. Device connections use Electron `safeStorage`; unavailable encryption never falls back to plaintext. The renderer uses the token in memory for authenticated requests, so a compromised trusted renderer remains a risk. Browser preview connections use tab session storage and survive reload, but do not promise persistence after the browser session ends.

Offline clients retain the last received status in memory and disable changes. No approvals or external writes are queued. Revocation clears saved connection data and stops automatic unauthorized polling. Workspace authentication does not establish website or connector authorization. Secure Store provides encrypted credential storage; Google Calendar is the only OAuth connector so far.

## Independent-host container

Run the host on a separate always-on Linux machine for Mac-off availability. The image uses the same lockfile, serves the built client and runs as the unprivileged `node` user.

```sh
docker build -t vesper .
docker volume create vesper-data
docker volume create vesper-secrets
docker run -d --name vesper --restart unless-stopped \
  -p 127.0.0.1:4317:4317 \
  -v vesper-data:/var/lib/vesper \
  -v vesper-secrets:/var/lib/vesper-secrets \
  -e VESPER_ALLOWED_ORIGINS=https://vesper.example.com,vesper://app \
  -e VESPER_HOST_LABEL='Home server' vesper
```

Put an existing TLS reverse proxy in front of port 4317. For example, a Caddy site can use `reverse_proxy 127.0.0.1:4317`. Configure your own hostname, DNS and network access. Do not expose raw HTTP publicly. Application authentication is required even on a private network. Apply request-rate controls at a trusted proxy using its verified client identity, without combining all proxied clients into one shared bucket. The host does not trust caller-supplied forwarded addresses. Pairing codes have 144 bits of randomness and request bodies are capped at 128 KiB; individual secure values remain limited to 16 KiB of UTF-8. Keep the separate private secrets volume out of database backups and future provider/browser worker mounts.

Read the initial code with `docker exec vesper cat /var/lib/vesper/pairing-code`. Renew it with `docker exec vesper node dist/server/pairing.js`. Do not paste codes into issues or PRs. This remains a deployment path, not proof of a running independent host or tested container deployment.

## Verification and release limits

Use the consistent SQLite backup command and [vault recovery workflow](vault.md). It preserves workspace/device state and the wrapped vault recovery copy while excluding the raw key file. Keep the backup private; non-credential workspace data is not separately encrypted. Local mode must also preserve the desktop's encrypted connection to reconnect without a new pairing. Browser profile storage is not implemented by this slice.

Run `npm run check` for repository metadata, typechecking, lint, desktop syntax and production builds. CI repeats these checks. They do not prove behavior. Temporary verification outside the repository checks actual HTTP/SQLite outcomes, old-database compatibility, private utility-process bootstrap, real process shutdown/crashes, occupied-port recovery, bounded retries and encrypted device storage. The owner's instruction is to keep these harnesses outside the repository and report their outcomes. No retained test suite is added.

The first-run Muse screen is unverified. This temporary setup UI does not claim Muse parity or replace the complete Mac/Android target. Native voice, screen context, notch/hotkey access and personal integrations remain required product work. Later UI changes need direct reference inspection, matched screenshots and motion evidence.

## Claude chat connection

The first provider slice uses `@anthropic-ai/claude-agent-sdk` 0.3.283 with an existing eligible Claude login on the machine running the host. The executable defaults to `~/.local/bin/claude`; a host operator can override its absolute path with `VESPER_CLAUDE_PATH`. A remote host needs its own eligible login. The packaged Mac app uses the local login without copying tokens into Vesper's database. Other harnesses remain visibly unavailable.

Open the Provider panel and explicitly refresh availability. Select the discovered account/model, then apply it to that conversation. Each new send pins that selection and its revision. A fresh initialization checks account, resolved model, subscription availability and disabled paid overage before releasing the prompt. Missing or incompatible metadata blocks the run. The SDK's experimental subscription-usage control is a pinned compatibility dependency; this personal verification does not settle eligibility for public third-party distribution.

The adapter has chat capability only. It disables built-in tools, MCP, Claude connectors, project settings, memory, hooks and plugins, excludes API/cloud billing overrides and uses a dedicated runtime directory. Before a turn, proof consists of explicit SDK options and verified spawn flags; the actual turn initialization must also report empty tools and MCP before text is accepted. No action or browser broker is implemented by this slice.

Runs have durable queued, initializing, running, cancelling and terminal states. Stop waits for an SDK/process completion receipt; an unknown cleanup outcome is not represented as a confirmed cancellation. The host limits concurrent replies to two, caps each output and run duration, and never starts idle inference. Restart marks unfinished runs interrupted rather than resubmitting them. Repeating the same request reads its original receipt; changing its payload is a conflict. Stream text is persisted in short batches and shared through the existing authenticated change cursor.

Native session resume is deliberately unavailable. Each turn receives up to the latest 20 visible conversation messages within 60,000 characters, including the status of partial earlier replies. The same bounded history supports explicit provider changes later; it does not promise hidden provider reasoning or unlimited context continuity. Drafts pin their intended provider only when the user presses Send. Existing pending save-only messages stay save-only after upgrade. Reconnect only reads state and receipts.

## Mac quick chat and voice drafts

The app owns one reusable quick window near the top of the active display, plus a menu-bar entry. Its requested default shortcut is `Alt+Space`, matching the recorded Muse setting. If another app owns that shortcut, Vesper shows the conflict and keeps manual/menu-bar access. It never quits Muse or silently substitutes another shortcut. Set an alternative explicitly in the full window's Quick chat controls. Requested and active shortcuts are distinct; a failed replacement keeps the old working registration. Escape or Dismiss hides the quick window; quitting removes Vesper's registration and tray.

Quick and full windows use the same active conversation, authenticated host and actual provider run. Unsent drafts remain local and encrypted. The main process checks draft revisions before writing and notifies the other window after persistence. A stale writer keeps its text unsaved and cannot overwrite the other window through queued retries. Explicit Retry saving chooses the retained local text. Neither opening quick chat nor reconnecting sends a message or starts inference.

Voice input uses a small Swift helper compiled by `npm run build:native` with the installed macOS SDK, bundled outside asar in `Resources/native`. The speech engine requires macOS 26. Check voice queries supported locale/assets without capturing audio. Prepare on-device voice explicitly requests Apple's language assets when missing. Record voice requests microphone access and starts one bounded session; Stop finalizes its transcript into the current draft, while Cancel/dismissal/quit releases capture without inserting provisional text. The session is limited to two minutes. Audio stays in memory and is never given to a provider; submitting the draft is a separate action. Native helper commands and responses are bounded and checked by trusted main-process code. Chromium microphone/camera permissions remain denied.

Public signing/notarization and actual packaged microphone authorization are separate release checks. Test on-device file recognition with a temporary ordinary synthetic voice fixture, then delete it; this verifies the transcription engine, not live microphone capture. A present user must deliberately test a harmless spoken phrase to verify recording and permission identity. No unattended room audio should be captured to manufacture a pass. The compact window's dimensions and placement are explicit Vesper defaults pending direct Muse notch/motion measurements.

## Google Calendar

Settings → Connectors connects one or more Google accounts with the read-only `calendar.readonly` scope. Vesper cannot create, change or delete events yet; writes wait for the exact-operation approval broker.

The host operator supplies a Google OAuth client. In Google Cloud, enable the Google Calendar API, configure the consent screen and create a **Desktop app** OAuth client. Download its JSON and save it as `google-oauth-client.json` in the host data directory: `~/Library/Application Support/Vesper/local-host` for the Mac app, or `VESPER_DATA_DIR` for an independent host. `VESPER_GOOGLE_CLIENT_FILE` selects another path. The file is read on use, so a running host needs no restart. Never commit it. A consent screen left in Testing mode issues refresh tokens that Google expires after seven days; publish it for lasting personal use and expect Google's unverified-app warning until the app is verified.

Connect opens Google's page in the system browser using PKCE and a single-use state that expires in ten minutes. Google redirects to `/oauth/google/callback` on the address the client uses for the host. Desktop clients accept only loopback redirects, which fits the Mac's local host. An independent HTTPS host needs a **Web application** client whose authorized redirect URI is exactly `https://<host>/oauth/google/callback`. Secure Store must be set up and unlocked. The refresh token is saved there as an `oauth` entry bound to the Google account and `https://oauth2.googleapis.com`. Each sync obtains a fresh access token through Secure Store's account, origin and revision check, so revoking or changing the entry stops access at the next sync; access tokens are not cached. Neither reaches clients, logs or a model.

Sync runs when an account connects and when the user chooses Sync now. Sync now starts the work on the host and returns; every client sees Syncing and the result through change notices. A sync records its outcome only while the account still uses the credential it started with, and reconnecting during a sync starts a fresh one afterwards. There is no background or scheduled sync yet, and no model call is involved. The first sync reads every visible calendar from one week back, expanding recurring events. Later syncs use each calendar's Google sync token. Updated events replace their rows by account, calendar and event ID; cancelled events are removed; an expired sync token (HTTP 410) replaces that calendar's rows with a fresh full read. Each calendar's changes and token commit in one SQLite transaction, so an interrupted sync repeats rather than skipping changes. Calendars removed from the account are deleted locally.

The agenda shows the next seven local dates, listing multi-day events on each date they cover, labelled by calendar and, with several accounts, by account. Timed events that overlap across calendars or accounts are marked. All-day, free and declined events are not treated as conflicts, and copies of the same invitation (same iCal UID) do not conflict with each other.

Revoked or expired Google access, or a changed or removed Secure Store entry, shows Reconnect needed. Reconnecting the same Google account keeps its identity and replaces the stored token. A locked vault or unreachable Google keeps synced data and shows the reason. Disconnect asks Google to revoke the grant, deletes the account's calendars and events, and removes its Secure Store entry. If Google does not confirm revocation, the app says so. Revoking a token revokes that Google user's grant to the whole OAuth client, so use a client dedicated to Vesper.

The first Google Calendar start migrates the workspace database from schema 4 to schema 5. Back up first; an older host refuses schema 5.
