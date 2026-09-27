# Vesper handoff

The user wants an exact Muse-style open personal agent for macOS and Android, with their choice of agent harness and eligible subscription. This phase researches and sets up future development. Do not begin unrelated app implementation while completing setup.

Read [product specification](docs/product-spec.md), [provider requirements](docs/providers.md), [observations](docs/muse-observations.md), [research](docs/research.md), and the assigned item in [backlog](docs/backlog.md). Follow [workflow](docs/workflow.md) and `AGENTS.md`.

Also read [architecture and concrete reuse](docs/architecture-and-reuse.md). The user explicitly wants parts and features reused, especially from T3, rather than a fork of an entire app. This deeper report identifies source files, dependency costs, license checks and changes required at security boundaries.

## Current state

- Application implementation has not started. No backend behavior has been tested.
- Muse 4.1 Mac UI and website were inspected through computer use. The initial main chat was read through the accessibility tree, with some long offscreen messages truncated. Static screenshots were captured inline; no screenshot folder or private transcripts were created in this repository.
- T3 Code source was inspected at commit `ab099178a7b7f9728843e90fc95ed90bb61d710d` in a temporary checkout outside Vesper.
- Recommended stack is Electron/React for Mac, React Native/Expo with Kotlin modules for Android, shared TypeScript contracts/client runtime, Node/Effect services and SQLite durable state. Exact dependency pins are a bootstrap task.
- Codex, Claude, OpenCode, Antigravity and custom provider adapters are required. Claude technical integration is verified from T3 source, but subscription eligibility for a third-party product remains a separate gate.
- Linear project exists: https://linear.app/imraghavojha/project/vesper-d4bae716cdc0/overview.
- GitHub and external review setup status is recorded below after verification.

## Next agent

Start with V01 for remaining reference capture or V02 for workspace bootstrap. V22 handles external review authorization. V24 can proceed after avatar/motion references are settled. Browser/vault isolation and shared contracts precede real connector implementation. Claim the corresponding Linear issue before work and use its ID in the branch/PR.

Do not claim perfect cloning from screenshots alone. Active browser details, Android UI, motion timings and less common dialogs still need evidence. Do not copy Muse's inconsistent month-end scheduling: its chat, goal description and upcoming date disagree.

Keep the full Muse feature target, including settings/catalog/library, while delivering it through small issues. User-requested differences are switchable providers, no unsolicited agent work, AI/coding HN feed with swipe feedback, original Vesper branding and explicit controls over schedules and credentials.

## Setup verification

- Public MIT repository created at https://github.com/imraghavojha/vesper. Squash merging and branch deletion after merge enabled.
- Created 24 Vesper Linear issues, IMR-5 through IMR-28, with acceptance criteria and dependency descriptions. Exact links are in `docs/backlog.json` and `docs/backlog.md`. Native blocking relationships are not configured.
- Existing Linear Code GitHub App installation was inspected. It is already enabled for all current/future repositories on the user's account, so Vesper is covered without a new permission grant. No existing installation permissions were changed. PR linkage still needs verification with the setup PR.
- Greptile repo configuration is prepared. Its sign-in page requires GitHub identity authorization; no Greptile repository installation or review has been verified. A free-plan offer is not an activated account.
- Local repository checks and skill validation passed. Croner research cases for true month end and Chicago DST passed. These are not application/backend tests.
- Native Muse control later timed out after closing Settings, including a fresh computer-use session. The remaining reference gaps are recorded in V01; do not claim all screens/animations were captured.
- CI, setup PR and branch protection results will be added after verification.
