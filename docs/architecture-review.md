# Architecture review with Claude

The user requested Claude Fable, then explicitly selected Claude Opus 5.5 after Fable returned an out-of-usage-credits error before inference. Three completed CLI review calls reported `claude-opus-5-5` in model usage. Calls used the installed authenticated Claude CLI, high effort, tools disabled and safe mode. Only a sanitized product/research brief was supplied, with no Muse secrets or personal transcript.

The first round independently recommended one authoritative host and SQLite, shared credential use through that host, host-owned browser sessions, plain TypeScript adapters and no extra planner. It suggested per-record encryption keys and a streamed Playwright browser, and proposed dropping some requested integrations.

The second round challenged those choices. It settled a single vault key with standard per-record authenticated encryption, explicit native Android viewing/input work, and official generated Codex types rather than copying Effect schema code. It considered Electron-hosted browsing, which the subsequent independent-host requirement superseded. Google Messages and the broader product target remain in scope; Canvas prefers API/token access.

The primary agent made several final corrections to the review:

- Keychain does not inherently make sync impossible, because a service could proxy access. It was rejected here because the user requested a portable shared vault without that dependency.
- T3's inspected preview includes webview-specific code. We do not claim it already provides a drop-in WebContentsView plus Android browser implementation.
- High-volume frames must not block approvals. App RPC and optional transient frame delivery share a host/authentication boundary, not necessarily one unlimited JSON stream.
- Secret-entry traffic must carry the user's credential to the trusted host. The no-secret guarantee applies to model output, ordinary events/logs and caches, not to pretending this secure submission contains no password.
- External actions do not gain exactly-once guarantees from a local job table. Uncertain outcomes remain visible and are not blindly retried.
- An Electron-hosted browser does not become a headless Linux service merely by copying its data. That hosting capability is deferred, not promised as zero work.
- No unsolicited model loop is allowed. Explicitly scheduled autonomous work remains a core feature.

A third round reviewed public-release reliability and rejected putting the backend in Electron main. The user then explicitly selected an independent shared host that keeps running while the Mac is off. The final design uses a separate backend and supervised Chromium/provider workers; both platform apps are clients. The primary agent selected maintained noVNC viewing components after inspecting their mobile/input support, rather than claiming T3 supplies a drop-in hosted browser.

The resulting decision is [final-architecture.md](final-architecture.md). Source-level research remains in [architecture-and-reuse.md](architecture-and-reuse.md). Linear issues contain product outcomes and acceptance criteria only.
