# Development

The first application slice provides an authenticated shared workspace, a Mac client and a browser client. It does not implement chat, providers, connectors, schedules or Android. IMR-6 remains open until its remaining platform and independent-host acceptance is demonstrated.

## Run on Mac

Use Node 24.21.0 from `.nvmrc` and the checked-in npm lockfile. TypeScript is pinned to 6.0.3 because the current TypeScript ESLint release supports TypeScript below 6.1. Version choices were checked against the npm registry on September 27, 2026.

```sh
nvm install
nvm use
npm ci
npm run dev:server
```

In another terminal, run `npm run dev:web`, then `npm run desktop`. The backend listens on `127.0.0.1:4317`, Vite on `127.0.0.1:5177`. Electron loads the web client and does not start or own the backend. Quitting Electron leaves the host running. Closing the host or shutting down this Mac makes a locally hosted workspace unavailable.

For the production web build, run `npm run build`, then `npm start`. Open `http://127.0.0.1:4317`. `NODE_ENV=production npm run desktop` uses this built client. Set `VESPER_DESKTOP_URL` to use another trusted HTTPS host in production mode. The desktop only permits its configured renderer origin and sends external HTTPS links to the system browser.

The host creates `.vesper/workspace.sqlite` and an `initialized` marker. The marker prevents a missing database from silently becoming a new workspace. Keep both in backups. `VESPER_DATA_DIR` selects a different private data directory. Every worktree and verification run must use a separate directory and ports. `VESPER_PORT`, `VESPER_BIND`, `VESPER_HOST_LABEL` and comma-separated `VESPER_ALLOWED_ORIGINS` configure listening and browser access. Origin entries must exactly match the client origin, without a trailing slash.

## Pair devices

The initial host writes a random, one-use code to its private `pairing-code` file. Open that file locally, enter it in the client, and name the device. Codes expire in ten minutes. A connected client can create another code from its devices panel. A code grants full access to this single-owner workspace, so share it only with your own devices.

A host operator can run `npm run pairing-code` to create a replacement code. With compiled production files, run `node dist/server/pairing.js`. Use the same `VESPER_DATA_DIR` as the running host. This recovers access after a lost device or interrupted first pairing without deleting the workspace. It does not revoke existing devices. Recovery publishes the private file through an atomic rename while holding the SQLite write transaction, so revocation cannot occur between code insertion and publication. A later device revocation still cancels the code normally. Revoke lost devices from the connected client afterwards.

Pairing atomically consumes the code and creates a device. The host stores only token/code hashes. Device revocation invalidates subsequent requests and atomically cancels every unused pairing code in this single-owner workspace. Create a new code after revoking a device; a code issued before revocation cannot restore access. Repeating the same completed revocation preserves codes created afterwards. Clients pin the workspace ID and refuse a different workspace at the same URL. Workspace renames carry an expected revision and reject stale edits. The first slice refreshes status every three seconds while visible; it is not the later durable event-stream sync implementation.

The Mac shell stores its device connection using Electron `safeStorage`, backed by the operating system. It fails to save if encryption is unavailable. Only its trusted top-level renderer can call the narrow load/save bridge. The renderer needs the token in memory for requests, so a compromised trusted renderer remains a risk. The browser preview retains its connection only in tab session storage. It survives reload, but does not promise persistence after the browser session ends. Neither client stores website passwords or third-party account tokens in this slice.

Offline clients keep the last received status in memory and disable changes. A restarted offline client may have no cached workspace details. No approval or external write is queued offline. The host performs no background model calls.

## Independent host

Run the host on a separate always-on Linux machine to keep it available when the Mac is off. The container build uses the same lockfile and serves the built web client. The image runs as the unprivileged `node` user.

```sh
docker build -t vesper .
docker volume create vesper-data
docker run -d --name vesper --restart unless-stopped \
  -p 127.0.0.1:4317:4317 \
  -v vesper-data:/var/lib/vesper \
  -e VESPER_ALLOWED_ORIGINS=https://vesper.example.com \
  -e VESPER_HOST_LABEL='Home server' vesper
```

Put an existing TLS reverse proxy in front of port 4317. For example, a Caddy site at `vesper.example.com` can use `reverse_proxy 127.0.0.1:4317`. Use your own hostname and configure DNS/network access. Remote clients require HTTPS. Do not expose the raw HTTP port publicly. Application authentication is required even on a private network. Apply request-rate controls at the trusted reverse proxy using its verified client identity, without combining all proxied clients into one shared bucket. The application does not trust caller-supplied forwarded addresses. Its 144-bit pairing codes expire after ten minutes and are consumed once; request bodies are capped at 16 KiB.

The initial code is inside `/var/lib/vesper/pairing-code`. The host operator can read it using `docker exec vesper cat /var/lib/vesper/pairing-code`. To renew it, use `docker exec vesper node dist/server/pairing.js`. Do not paste codes in issues or PRs.

This configuration is a deployment path, not evidence of a running independent host. Mac-off availability, container runtime operation and Android remain unverified until checked on the actual deployment. Scheduled work is not implemented yet.

## Recovery and checks

For a simple consistent backup, stop the host and copy its entire data directory, including the database and `initialized` marker. Restore that directory with owner-only permissions before restarting. Backups contain authentication hashes and private workspace metadata. Browser profiles and a shared credential vault do not exist yet.

Run `npm run check` for repository checks, typechecking, lint and production builds. CI repeats these checks. Desktop CommonJS files receive syntax checks in CI. `npm run format` formats the application files. These static/build checks do not prove behavior.

Temporary end-to-end verification uses separate host processes and real SQLite files outside the repository. It checks authentication, concurrent one-use pairing, independent clients, stale rename conflicts, revocation, clean/crash restarts, missing-database refusal and malformed HTTP requests. No unit-test suite or temporary test harness is retained, following the user's instruction. PR evidence records outcomes and any unverified cases. Never store real account content or private screenshots in the repository.

The first-run reference in Muse has not been observed. This temporary workspace setup screen uses a neutral system light/dark style and does not claim Muse visual parity. It is not the final product design. The complete Muse layout, navigation, interactions and animations on Mac and Android remain the target, with only the documented Vesper differences. Later UI work must directly inspect the relevant Muse view and compare screenshots at matching sizes, plus motion evidence.
