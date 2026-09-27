# Vesper agent instructions

Vesper is an open Muse equivalent with interchangeable agent harnesses. Read `HANDOFF.md`, `docs/final-architecture.md` and the assigned Linear issue before coding. The initial repository is research and setup only; do not mistake configuration checks for application tests.

- Preserve the product scope in `docs/product-spec.md` and provider requirements in `docs/providers.md`. Exact reference behavior is the target unless an explicit Vesper difference is documented.
- Use one issue, branch, and isolated worktree per coding task. Coordinate shared schema/lockfile ownership before parallel work. Do not edit another agent's branch or live T3/Muse state.
- Never put real Muse chat, account secrets, browser profiles, cookies, private screenshots or personal mail/course data in fixtures, commits, Linear, or PRs. Use synthetic data.
- Keep the architecture simple: an independent shared TypeScript backend, SQLite for a personal deployment, maintained SDKs and an application-encrypted shared vault. Mac/Android sync and scheduled work must continue while the Mac is off. Follow docs/final-architecture.md. No custom VM/security platform or mandatory Effect framework.
- Credentials are captured/decrypted/filled in trusted app code, never returned to the model. Test origin/account checks, redacted observations and logs. Use standard worker restrictions and test access boundaries; do not claim encryption defeats a compromised host administrator.
- All external writes pass through the action/approval broker. Provider adapters do not get a bypass. Action approval must match the account, origin and exact operation.
- No unsolicited heartbeat or idle LLM calls. Schedules pin provider/account and have retry/run budgets. No silent paid fallback.
- Keep web/desktop/Android contracts aligned. State unsupported capabilities explicitly. Never say an intent dispatch proves an alarm was created, or a login message proves a live session still works.
- For backend changes, test actual outcomes and recovery. Use fake clocks and explicit completion receipts rather than sleeps. Run focused local checks; CI owns broad checks after bootstrap.
- UI work needs direct reference inspection, matched screenshots and relevant motion evidence. The reference record identifies unverified views. Do not invent measured timings.
- Native credential entry and sensitive page captures must stay outside model-visible evidence.
- Use conventional PR titles with the Linear ID. Follow `.github/pull_request_template.md`. Link every worked PR to T3 with its available `link_pull_request` tool.
- Use `.agents/skills/vesper-babysit/SKILL.md` when asked to babysit. Evaluate bot comments against code; do not blindly apply them or call missing reviews green.
- Merge only with authorization for the current task. Do not install third-party account access or accept new subscriptions to satisfy an issue without the required user action.

Current check: `node scripts/check-repository.mjs`. Implementation commands and version pins belong in repository development documentation, not Linear issue descriptions. Keep this file short as the project grows.

Linear issues state product outcomes and acceptance criteria only. Keep code structure, libraries and implementation instructions in architecture documents.
