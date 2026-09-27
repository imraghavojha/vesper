# Vesper handoff

The user wants a public-ready Muse-style open personal agent for macOS and Android, with their choice of agent harness and eligible subscription, a shared vault, and an independent host that works while the Mac is off. Android is the primary everyday assistant, including native invocation, voice conversation and user-authorized screen context; Mac is a paired client. Mac-only users can run a local workspace without a phone or separate-host setup; local work pauses when the Mac is off. An independent host remains the option for durable provider/browser work and schedules while clients are off. Research and setup are complete. Application work now proceeds in sequential, reviewed Linear issues, with Mac workflows first and Android acceptance still required.

Read [final architecture](docs/final-architecture.md) and [Claude review record](docs/architecture-review.md), then [product specification](docs/product-spec.md), [provider requirements](docs/providers.md), [observations](docs/muse-observations.md), [research](docs/research.md), and the assigned item in [backlog](docs/backlog.md). Follow [workflow](docs/workflow.md) and `AGENTS.md`.

Also read [architecture and concrete reuse](docs/architecture-and-reuse.md). The user explicitly wants parts and features reused, especially from T3, rather than a fork of an entire app. This deeper report identifies source files, dependency costs, license checks and changes required at security boundaries.

## Current state

- IMR-9 adds the shared host vault foundation: AES-256-GCM credential records, private external key file, passphrase-wrapped recovery, metadata-only client responses, exact origin/account checks, lock/revoke states and recoverable rotation. Secure Store entry bypasses chat and never reads saved values back to clients. See [vault operations](docs/vault.md). OAuth consent, connector dispatch, browser filling/waiting-task resume, worker filesystem isolation and Android acceptance remain open; storing a credential does not prove any external account connection.

- The active phase is polished Mac-only delivery. Claude Opus 5.5 owns the reference-based UI replacement; the existing functional scaffold is not an accepted final design. Use fresh Muse frames and interaction evidence before implementing visual changes. Android and Calendar implementation wait while the Mac UI is corrected.

- IMR-14 adds a Mac quick-chat window using the same conversations, provider runs and encrypted drafts as the full window. Shortcut conflicts are visible and do not alter other apps. Explicit voice controls use a bundled Apple on-device speech helper; voice produces an unsent draft. Actual microphone permission/capture still requires a present-user verification; synthetic file transcription is separate evidence. The complete reference layout, motion, attachments/search/reactions and Android remain open.

- IMR-10 adds the first connected provider: Claude chat through its maintained Agent SDK, pinned to the discovered account and selected model. Messages and run receipts persist together; interrupted runs never restart automatically. Tools, MCP, inherited project instructions and external connectors are disabled. This is a chat-only slice, not completion of the broader provider or Claude action contracts.

- IMR-7 adds durable main/side conversations and user messages, shared appearance, workspace-global idempotent receipts, revision conflicts, authenticated change notifications with cursor/snapshot recovery, and private Mac/browser drafts. Drafts never send automatically. The remaining goal/approval domains and Android acceptance stay open.

- IMR-6 now includes an optional managed local Mac host and a Mac/browser workspace foundation: authenticated pairing, SQLite identity/device persistence, revocation, optimistic rename conflicts and reconnect status. See [development](docs/development.md). Temporary real HTTP/SQLite verification covered concurrent pairing, authentication, revocation, restart/crash recovery and malformed requests. Android, actual independent-host deployment and scheduled work remain open acceptance.
- Muse 4.1 Mac UI and website were inspected through computer use. The initial main chat was read through the accessibility tree, with some long offscreen messages truncated. Static screenshots were captured inline; no screenshot folder or private transcripts were created in this repository.
- T3 Code source was inspected at commit `ab099178a7b7f9728843e90fc95ed90bb61d710d` in a temporary checkout outside Vesper.
- Final design uses an independent shared Node/TypeScript backend, SQLite for a personal deployment, an application-encrypted shared vault, supervised Chromium/provider workers, Electron/React and React Native clients. Mac-off operation is required. Three completed Claude Opus 5.5 review rounds informed the decision. Public-release reliability and maintainability matter more than minimizing component count. Mac-Keychain-only storage and Mac-only hosting are rejected.
- Codex, Claude, OpenCode, Antigravity and custom provider adapters are required. Claude technical integration is verified from T3 source, but subscription eligibility for a third-party product remains a separate gate.
- Linear project exists: https://linear.app/imraghavojha/project/vesper-d4bae716cdc0/overview.
- GitHub and external review setup status is recorded below after verification.

## Next agent

Continue IMR-14 with Opus-led Mac visual and interaction parity. Preserve the working backend, provider runs, shared drafts and trusted IPC. After this UI work, prioritize the direct Google Calendar connector and its required encrypted credential storage. Direct connectors are primary where available and permitted; SubItUp uses Vesper's browser, this user's university Outlook uses the browser, and other Outlook accounts use direct connectors where permitted. Do not turn every service into a browser-only integration. Claim the corresponding Linear issue before work and use its ID in the branch/PR.

Do not claim perfect cloning from screenshots alone. Active browser details, Android UI, motion timings and less common dialogs still need evidence. Do not copy Muse's inconsistent month-end scheduling: its chat, goal description and upcoming date disagree.

Keep the full Muse feature target, including settings/catalog/library, while delivering it through small issues. User-requested differences are switchable providers, no unsolicited agent work, AI/coding HN feed with swipe feedback, original Vesper branding and explicit controls over schedules and credentials.

## Setup verification

- Public MIT repository created at https://github.com/imraghavojha/vesper. Squash merging and branch deletion after merge enabled.
- Created and revised 24 Vesper Linear issues, IMR-5 through IMR-28, to product outcomes and acceptance criteria only, with product prerequisite descriptions. Architecture, libraries and code structure are kept out of issue descriptions. Exact links are in `docs/backlog.json` and `docs/backlog.md`. Native blocking relationships are not configured.
- Existing Linear Code GitHub App installation was inspected. It is already enabled for all current/future repositories on the user's account, so Vesper is covered without a new permission grant. No existing installation permissions were changed. Setup PR #1 automatically appeared on IMR-26 and moved it to In Progress, verifying PR linkage.
- Greptile account and GitHub App were authorized after the user's explicit follow-up. Only `imraghavojha/vesper` was selected for installation and enabled for reviews. Optional usage learning was disabled. The `Greptile Review` check appeared on setup PR #1. Read its live status on GitHub rather than treating installation as a passing review.
- Greptile billing is a no-card trial ending October 10, 2026. The billing portal explicitly says service ends after the trial; no payment method or paid overage was added. The in-app free OSS checker requires 50 stars and rejects this new repository with 0. The advertised Starter tier was not offered in the inspected account/portal. Permanent free review service remains unresolved; never silently add billing. GitHub CI remains independent of Greptile.
- Local repository checks and skill validation passed. Croner research cases for true month end and Chicago DST passed. These are not application/backend tests.
- Native Muse control later timed out after closing Settings, including a fresh computer-use session. The remaining reference gaps are recorded in V01; do not claim all screens/animations were captured.
- Setup PR: https://github.com/imraghavojha/vesper/pull/1, registered with this T3 thread. GitHub `Repository checks` passed on the first head. Main protection requires this check, an up-to-date branch, a PR and resolved conversations, including for admins. Force pushes and branch deletion are disallowed. No human approving-review count is required for this solo-owner repository.
- Four product milestones organize the work: shared workspace/first-run experience; browser/logins/agent choice; everyday tasks/Muse interface; Android/release readiness. Shared-workspace IMR-6 is High priority and Todo. Prerequisites are in the backlog graph and descriptions.
