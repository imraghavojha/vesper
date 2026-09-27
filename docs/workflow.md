# Agent development workflow

Linear owns scope, acceptance and dependencies. GitHub owns code, reviews, checks and release history. T3 Code is the interactive control application. Vesper's shipped assistant is a separate product; never use its future personal-agent scheduler as the coding-agent scheduler by accident.

## Pick and deliver an issue

Read `HANDOFF.md`, `AGENTS.md`, the issue, and the relevant reference sections. Claim an unblocked issue, then create a branch such as `imr-6-browser-session`. Use a separate worktree for each concurrent coding agent. `t3.json` runs the repository's setup check when a worktree is created.

One agent owns one issue at a time. A coordinator may delegate independent work after shared contracts are agreed. Declare owned files and avoid parallel edits to contracts, schema migrations and the lockfile. Do not launch multiple test servers against one profile/database. Each worktree uses synthetic fixtures and separate runtime state/ports.

Make one reviewable change. Backend behavior needs focused tests of observable behavior and failure recovery. UI changes need matched-size screenshots and motion recordings where timing matters. Upload sanitized PR evidence instead of committing it. Read `docs/muse-observations.md` before claiming parity.

Create a draft PR with the Linear ID and issue URL, acceptance evidence, relevant tests and limitations. In T3, immediately call `link_pull_request` for each PR in a stack. Registering with `gh` alone is not enough. Mark ready only when the requested behavior and checks exist.

Run the `vesper-babysit` skill for an authorized PR. It checks the latest head, CI and review threads, verifies findings, fixes genuine defects, and stops when the required checks/reviews are current. An absent review bot is a setup gap, not a passing review. Do not keep a model polling forever.

Move Linear work to In Progress when claimed, In Review when the PR is ready, and Done only after the corresponding change is merged and acceptance evidence is attached. If automatic GitHub/Linear synchronization is not installed, perform these changes explicitly. Never report a webhook integration as active from configuration files alone.

## Review services and merge policy

Greptile is the preferred external reviewer. Its GitHub App is installed for Vesper only, repository reviews are enabled, and a review check appeared on the setup PR. Use base-tier review on ready PRs and meaningful updates; skip drafts. Do not sign up for paid overages. The current account has a no-card trial through October 10, 2026 and no confirmed permanent free plan. Check `HANDOFF.md` before relying on long-term service. CodeRabbit or Macroscope may be added later if their findings justify the additional noise/cost. T3's use of a sponsor is not proof of credits for Vesper.

GitHub should require the `Repository checks` status on main while this is a planning repository. The first implementation PR adds appropriate app typecheck, lint, domain tests and build checks, then updates protection. Do not keep a green documentation check as the only gate once code exists. Resolve review conversations before merge. Repository owner retains merge authority unless a later task explicitly authorizes autonomous merging.

For stacks, keep each layer independently understandable, record base dependencies, and link every layer. Prefer ordinary feature PRs until a stack provides a concrete benefit. Rebase only the agent-owned branch and never force-push another agent's work.

## No background spending

Worktree setup, CI and metadata synchronization should be deterministic. A coding agent runs when the user starts it or expressly schedules a bounded coding task. The babysitter exits after its task or budget. GitHub workflows do not contain model API keys or an unbounded fix/review loop.

## Sources

These practices adapt the inspected [T3 AGENTS.md](https://github.com/pingdotgg/t3code/blob/ab099178a7b7f9728843e90fc95ed90bb61d710d/AGENTS.md), [worktree configuration](https://github.com/pingdotgg/t3code/blob/ab099178a7b7f9728843e90fc95ed90bb61d710d/t3.json), and [CI](https://github.com/pingdotgg/t3code/blob/ab099178a7b7f9728843e90fc95ed90bb61d710d/.github/workflows/ci.yml). They are a Vesper workflow, not a claim to reproduce Theo's unpublished personal skills.
