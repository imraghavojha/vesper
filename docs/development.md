# Development

Vesper can open a local workspace on a Mac or connect to an independent host. Android is optional for Mac use. The current application handles workspace identity, device connections and shared workspace names. Chats, voice, notch/hotkey invocation, providers, connectors, schedules and Android are still being built. IMR-6 remains open for its remaining acceptance.

## Run the Mac app

Use Node 24.21.0 from `.nvmrc` and the checked-in npm lockfile.

```sh
nvm install
nvm use
npm ci
npm run build
npm run desktop
```

No separate server command is needed. The bundled first-run screen offers **Start on this Mac** and **Connect to existing host**. Starting locally creates or reopens the Mac's private workspace. It launches the backend in a separate Electron utility process and pairs the desktop privately. Device tokens remain in operating-system-backed encrypted storage. A phone is not required.

Build a local application bundle with `npm run package:mac`. Open `release/Vesper-darwin-arm64/Vesper.app` on Apple Silicon, or the `x64` directory on an Intel Mac. Copy that app to your Applications directory to use it without Node, npm or a terminal. The package contains only application code and production dependencies; no workspace data or browser profiles are copied from the checkout. These local builds are unsigned and not notarized. Public signed installers and updates remain release work.

The Mac's application data lives in `~/Library/Application Support/Vesper`. Its managed backend uses the `local-host` subdirectory. `VESPER_DESKTOP_DATA_DIR` selects an isolated application directory for development or verification. Never point two test applications at one directory.

Local mode listens only on loopback. The app saves the selected port and reuses it on relaunch. If another process occupies that port, Vesper launches its own worker on a fresh port, verifies the workspace identity and updates its encrypted connection. It never treats an unrelated existing listener as its host. Quitting the application stops the local backend. Closing the window on Mac leaves the app running. Turning off the Mac stops local work. The first slice does not run scheduled work yet.

A worker crash allows at most two automatic restart attempts per app lifetime. Existing device tokens are reused. Revoked tokens stay revoked. If local access was removed or forgotten, opening existing local data asks the Mac owner to confirm Restore access before privately creating a replacement device. This is host-owner administration through the trusted bundled app and the OS-owned private profile, equivalent in authority to the local recovery command. It is not available to remote clients or ordinary revoked tokens; revocation does not remove the host administrator's filesystem authority. After the restart budget is exhausted, the displayed Try again action starts the owned local worker with the existing saved token and workspace identity. It never creates a new device or restores a revoked token. Remote-host retry only refreshes the connection. No restart or connection check invokes a model.

## Connect to an independent host

The standalone backend remains deployable on ordinary Node 24.21.0. Run `npm run build`, then `npm start`. It serves the built web client on `http://127.0.0.1:4317` by default. For web development, `npm run dev:server` and `npm run dev:web` use ports 4317 and 5177. The Mac application uses its bundled renderer, not Vite or an externally hosted page.

Choose **Connect to existing host** in the Mac app and enter that host's address and pairing code. Remote hosts require HTTPS. An independent always-on host can stay available while the Mac is off. The current loopback-only local mode is for this Mac; use an independently reachable host for clients on other devices.

The host creates `.vesper/workspace.sqlite` and an `initialized` marker. Keep both in backups. The marker prevents a missing database from silently becoming a new workspace. `VESPER_DATA_DIR` selects another private directory. `VESPER_PORT`, `VESPER_BIND`, `VESPER_HOST_LABEL` and comma-separated `VESPER_ALLOWED_ORIGINS` configure listening and browser access. Origins must match exactly, without a trailing slash. Include `vesper://app` for the installed desktop and the host's HTTPS origin for its browser client.

## Runtime and SQLite

Electron 44.4.5 and the independently hosted Node 24.21.0 both include Node's built-in SQLite 3.53.4. Vesper uses the common `node:sqlite` API, so the Mac app does not bundle a second Node runtime or rebuild a native SQLite addon for Electron's different ABI. Existing workspace databases retain their schema, IDs and device credentials.

Node 24.21 documents `node:sqlite` as stability 1.2, release candidate, not fully stable. Keep Node and Electron pinned and verify upgrades against both runtimes. The application uses the small synchronous prepare/get/all/run API and explicit `BEGIN IMMEDIATE`, `COMMIT` and `ROLLBACK` transactions. It does not use changesets or a second synchronization database. See the [pinned Node SQLite documentation](https://raw.githubusercontent.com/nodejs/node/v24.21.0/doc/api/sqlite.md) and [Electron utility-process API](https://www.electronjs.org/docs/latest/api/utility-process).

## Pairing and recovery

An independently started host writes a random, one-use code to its private `pairing-code` file. Enter it in the client and name the device. Codes expire in ten minutes. A connected client can generate another code from the devices panel. Codes grant full access to this single-owner workspace.

A host operator can run `npm run pairing-code`, or `node dist/server/pairing.js` with compiled files, using the same `VESPER_DATA_DIR` as the host. This recovers a lost connection without resetting the database or revoking existing devices. Recovery atomically publishes a private file while holding the SQLite write transaction. Subsequent device revocation still cancels the code normally.

Pairing atomically consumes its code and creates a device. Only token/code hashes are stored in SQLite. Revocation invalidates subsequent requests and cancels every unused pairing code. Repeating an already completed revocation preserves codes created afterwards. Clients pin workspace IDs and refuse a different workspace at the same address. A saved local connection also supplies its expected workspace ID before startup. Missing local data, including loss of the entire local-host directory, requires restoration instead of silently creating a replacement database. Renames reject stale revisions. Status refreshes every three seconds while visible; durable event-stream synchronization belongs to the next sync work.

An upgrade from the first Mac preview migrates its encrypted connection without changing the token, endpoint or pinned workspace. Legacy records are accepted only when the old HTTP(S) renderer origin equals the validated endpoint, or equals the exact former built-in development origin `http://127.0.0.1:5177`. They become remote connections and are atomically saved under the new renderer identity. Unknown and opaque origins remain rejected.

The Mac renderer loads only bundled `vesper://app` resources. Its IPC guards check the exact scheme and `app` authority, not Node's opaque `URL.origin` value. Only the trusted top-level renderer can access the narrow connection and local-host bridge. Device connections use Electron `safeStorage`; unavailable encryption never falls back to plaintext. The renderer uses the token in memory for authenticated requests, so a compromised trusted renderer remains a risk. Browser preview connections use tab session storage and survive reload, but do not promise persistence after the browser session ends.

Offline clients retain the last received status in memory and disable changes. No approvals or external writes are queued. Revocation clears saved connection data and stops automatic unauthorized polling. Website credentials and provider tokens are not part of this slice.

## Independent-host container

Run the host on a separate always-on Linux machine for Mac-off availability. The image uses the same lockfile, serves the built client and runs as the unprivileged `node` user.

```sh
docker build -t vesper .
docker volume create vesper-data
docker run -d --name vesper --restart unless-stopped \
  -p 127.0.0.1:4317:4317 \
  -v vesper-data:/var/lib/vesper \
  -e VESPER_ALLOWED_ORIGINS=https://vesper.example.com,vesper://app \
  -e VESPER_HOST_LABEL='Home server' vesper
```

Put an existing TLS reverse proxy in front of port 4317. For example, a Caddy site can use `reverse_proxy 127.0.0.1:4317`. Configure your own hostname, DNS and network access. Do not expose raw HTTP publicly. Application authentication is required even on a private network. Apply request-rate controls at a trusted proxy using its verified client identity, without combining all proxied clients into one shared bucket. The host does not trust caller-supplied forwarded addresses. Pairing codes have 144 bits of randomness and request bodies are capped at 16 KiB.

Read the initial code with `docker exec vesper cat /var/lib/vesper/pairing-code`. Renew it with `docker exec vesper node dist/server/pairing.js`. Do not paste codes into issues or PRs. This remains a deployment path, not proof of a running independent host or tested container deployment.

## Verification and release limits

For a consistent backup, stop the host and copy its entire data directory, including the database and `initialized` marker. Restore that directory with owner-only permissions. Local mode must also preserve the desktop's encrypted connection to reconnect without a new pairing. Browser profiles and a shared credential vault do not exist yet.

Run `npm run check` for repository metadata, typechecking, lint, desktop syntax and production builds. CI repeats these checks. They do not prove behavior. Temporary verification outside the repository checks actual HTTP/SQLite outcomes, old-database compatibility, private utility-process bootstrap, real process shutdown/crashes, occupied-port recovery, bounded retries and encrypted device storage. The owner's instruction is to keep these harnesses outside the repository and report their outcomes. No retained test suite is added.

The first-run Muse screen is unverified. This temporary setup UI does not claim Muse parity or replace the complete Mac/Android target. Native voice, screen context, notch/hotkey access, provider-backed replies and personal integrations remain required product work. Later UI changes need direct reference inspection, matched screenshots and motion evidence.
