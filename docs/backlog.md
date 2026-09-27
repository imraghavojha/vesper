# Engineering backlog

The Linear project is https://linear.app/imraghavojha/project/vesper-d4bae716cdc0/overview. The machine-readable source is [backlog.json](backlog.json). Dependencies below define scope ordering; independent work may proceed concurrently in isolated worktrees after contracts settle. Dependencies are recorded in issue descriptions; do not assume native Linear blocking relationships are installed.

- [IMR-5: V01 Capture remaining Muse views and motion references](https://linear.app/imraghavojha/issue/54e9dd94-32af-41b0-ae86-b77961394faa)
- [IMR-6: V02 Bootstrap React desktop and React Native workspace](https://linear.app/imraghavojha/issue/985f227d-b01a-462c-b544-2fff3d773368)
- [IMR-7: V03 Define durable run, approval and provider contracts](https://linear.app/imraghavojha/issue/24bb5e81-16e1-4e90-9126-46d9eff5791e)
- [IMR-8: V04 Prove embedded browser session and vault isolation](https://linear.app/imraghavojha/issue/553b84e6-e92d-4d90-979f-7f557f78717e)
- [IMR-9: V05 Build secure store and credential-request resume flow](https://linear.app/imraghavojha/issue/2175c734-16a1-493d-b0f6-e94b420d686d)
- [IMR-10: V06 Add provider registry, picker and portable handoff](https://linear.app/imraghavojha/issue/bb2e04b0-4d29-4eb6-b3da-edb838ca8ec2)
- [IMR-11: V07 Integrate Codex App Server and bounded exec jobs](https://linear.app/imraghavojha/issue/f84340ba-d4a9-41b0-9608-bbd0384892e8)
- [IMR-12: V08 Integrate Claude Agent SDK and verify subscription eligibility](https://linear.app/imraghavojha/issue/68b2b780-4a4c-4013-b4c3-22c827e921b7)
- [IMR-13: V09 Integrate OpenCode and Antigravity adapters](https://linear.app/imraghavojha/issue/5a84dcce-b149-4dbd-9ea9-728a397121e1)
- [IMR-14: V10 Clone desktop navigation, main chat and side chats](https://linear.app/imraghavojha/issue/2ea97df0-575d-4df9-9af5-9bff585661e9)
- [IMR-15: V11 Clone activity, approvals, upcoming and identity panels](https://linear.app/imraghavojha/issue/bc631fbf-d118-4801-9c52-affedd29e120)
- [IMR-16: V12 Implement schedules, reminders and goals without heartbeat](https://linear.app/imraghavojha/issue/bb51dbc5-387d-4211-acda-810fd0b31a3f)
- [IMR-17: V13 Connect multiple Google calendars and Gmail accounts](https://linear.app/imraghavojha/issue/8163be7b-9e46-4457-bdd6-c99fba17944a)
- [IMR-18: V14 Add Canvas custom token connector](https://linear.app/imraghavojha/issue/344ed2d0-8295-4eda-a69f-7fbfa2adeb88)
- [IMR-19: V15 Add SubItUp monthly reconciliation and Outlook browser fallback](https://linear.app/imraghavojha/issue/a1b9bce6-bd1d-46e3-8427-bc058ac5edc4)
- [IMR-20: V16 Build Hacker News feed with swipe learning](https://linear.app/imraghavojha/issue/9bbe40e8-d5b2-427a-b486-b30b738c04b4)
- [IMR-21: V17 Clone settings, library and on-demand ideas](https://linear.app/imraghavojha/issue/b3013a16-0b72-46ba-9d38-3adf26e06792)
- [IMR-22: V18 Build Android navigation and shared client parity](https://linear.app/imraghavojha/issue/32ea4850-9a32-42e3-a048-681bf928d988)
- [IMR-23: V19 Add Android alarms, assistant invocation and device capability checks](https://linear.app/imraghavojha/issue/c1196f3b-a81f-4f3a-8506-5c69ff0baaf3)
- [IMR-24: V20 Evaluate Google Messages and scoped phone automation](https://linear.app/imraghavojha/issue/3bc5535c-ddbe-4e68-a2d4-56ad521e8c93)
- [IMR-25: V21 Verify end-to-end reliability, isolation and visual parity](https://linear.app/imraghavojha/issue/10a6d525-2666-43dc-bb57-bc653adb5ca3)
- [IMR-26: V22 Activate GitHub, Linear and Greptile review automation](https://linear.app/imraghavojha/issue/15068606-4e2b-47b2-8a1f-0216aecce4d1)
- [IMR-27: V23 Extend Muse integration catalog and wallet parity](https://linear.app/imraghavojha/issue/ad6ffaa2-4071-4ad0-ad42-89ec2a32eb5f)
- [IMR-28: V24 Create original Vesper avatar and motion assets](https://linear.app/imraghavojha/issue/f71b6da1-f977-47bd-a6cd-1dc459f194e1)

## V01 Capture remaining Muse views and motion references
+
+Area: reference. Depends on: none.
+
+Directly inspect Android, active browser takeover, search, pending approvals, identity editing and all dialogs. Read remaining expanded initial-thread messages without retaining secrets. Record matched dimensions, animation duration/easing and reduced-motion behavior. Keep captures selective and outside git; distinguish observed facts from inferred behavior.
+
## V02 Bootstrap React desktop and React Native workspace
+
+Area: foundation. Depends on: none.
+
+Pin compatible Node, package manager, React, Electron, Expo and TypeScript versions. Establish apps/web, desktop, mobile, server and shared contracts/client-runtime. One command launches isolated development state. CI typechecks/builds relevant clients and runs real tests. No feature claim from placeholder screens.
+
## V03 Define durable run, approval and provider contracts
+
+Area: foundation. Depends on: V02.
+
+Shared schemas cover chat, goals, schedule, provider capabilities, tool calls, approval state and durable receipts. Prove restart/replay ordering, stale-version rejection and migration rollback/recovery with synthetic fixtures. Establish event IDs and idempotency before parallel feature work.
+
## V04 Prove embedded browser session and vault isolation
+
+Area: browser. Depends on: V02, V03.
+
+Use fake test credentials and local test sites to prove same visible user/agent session, persisted per-account profiles, immediate takeover/cancel, HTTPS origin and redirect checks. Demonstrate the model shell, DOM reads, logs and screenshots cannot recover secrets. Decide isolation architecture from evidence; do not claim a separate process alone is sufficient.
+
## V05 Build secure store and credential-request resume flow
+
+Area: browser. Depends on: V01, V04.
+
+Match domain list and URL/Username/Password form, validation/focus/reveal states and chat request card. Secret capture bypasses transcript; broker consumes opaque IDs. Tests cover cross-origin/iframe leakage, account separation, revoked grants, expiration, cancellation and resumed task. Never use real credentials in CI.
+
## V06 Add provider registry, picker and portable handoff
+
+Area: providers. Depends on: V03.
+
+Composer and schedule editor choose harness/account/model with capability and usage status. Switching creates a truthful provider handoff while preserving Vesper chat and artifacts. Stop active runs first, invalidate pending approvals and never transfer hidden reasoning. Contract tests prove no silent account or paid-provider fallback.
+
## V07 Integrate Codex App Server and bounded exec jobs
+
+Area: providers. Depends on: V06, V04.
+
+Support installed authenticated Codex via documented interfaces, streaming, resume, tool approvals, interrupt and bounded exec. Discover models/capabilities. Run common adapter contract suite; optional authorized live smoke. Record Vesper-added context and usage without exposing account tokens.
+
## V08 Integrate Claude Agent SDK and verify subscription eligibility
+
+Area: providers. Depends on: V06, V04.
+
+Study pinned T3 ClaudeAdapter and current Anthropic docs. Implement supported SDK sessions, approval callbacks, custom tools, streaming, cancellation and account isolation. Verify subscription eligibility separately from technical feasibility; API path remains available without silent billing fallback. Bare mode must not be advertised as subscription-compatible.
+
## V09 Integrate OpenCode and Antigravity adapters
+
+Area: providers. Depends on: V06, V04.
+
+Use OpenCode server/events and official Antigravity ACP interfaces. Support auth/model discovery, resume where supported, cancel, permission mapping, provider errors and limits. Separate account instances. Mark unsupported capabilities honestly. Split into separate PRs per adapter if independently reviewable.
+
## V10 Clone desktop navigation, main chat and side chats
+
+Area: ui. Depends on: V01, V02, V03.
+
+Match rail, resizable sidebar, main conversation, composer, unread markers, channel labeling and side-by-side chat. Wire durable messages and provider picker, not canned replies. Demonstrate streaming, attachments, reply/copy/reaction, cancel, empty/error states, focus and keyboard behavior with synthetic reference-like data.
+
## V11 Clone activity, approvals, upcoming and identity panels
+
+Area: ui. Depends on: V01, V03, V10.
+
+Match all four right tabs, original avatar placement and status. Activity links to real receipts. Approvals bind exact action/account/origin; stale changes require a fresh grant. Upcoming derives canonical schedules. Identity has editable versioned memory and forget. Provide pending/error/history states and motion evidence.
+
## V12 Implement schedules, reminders and goals without heartbeat
+
+Area: automation. Depends on: V03.
+
+Durable jobs with per-run budgets, leases, idempotency, pause/resume and explicit trigger provenance. Prove zero model invocations during idle fake-clock intervals. Test February/leap years, months with 30/31 days, DST, timezone edits, sleep/missed runs, restart and duplicate delivery. Goal text and next run use the same schedule.
+
## V13 Connect multiple Google calendars and Gmail accounts
+
+Area: integrations. Depends on: V03, V05.
+
+Use supported OAuth and per-account/calendar sync cursors. Cover Gmail history recovery, Calendar 410, pagination, refresh/revocation, wrong-account protection and conditional updates. Demonstrate drafts and explicit send approval, agenda/conflicts and deduplicated event writes. Add Contacts/Tasks capability tickets if not one reviewable change.
+
## V14 Add Canvas custom token connector
+
+Area: integrations. Depends on: V03, V05.
+
+Institution base URL and token captured securely. Discover and display actual courses, assignments, submission status, announcements and permitted grades/materials. Cover pagination, token expiry, 403, rate limits and unsupported endpoints. Scheduled checks only when requested; use synthetic course fixtures.
+
## V15 Add SubItUp monthly reconciliation and Outlook browser fallback
+
+Area: integrations. Depends on: V04, V05, V12, V13.
+
+Preserve the employee SSO route and existing session; do not repeatedly log out to test MFA. Last-day job compares whole next month against selected calendar, displays a diff and applies only scoped changes without duplicates. Outlook uses Graph when allowed or permitted browser session. Separate PRs for the two connectors. MFA failure pauses/notifies; no guessed approval buttons.
+
## V16 Build Hacker News feed with swipe learning
+
+Area: feed. Depends on: V01, V03, V10.
+
+Clone editorial feed presentation for explicit AI/coding topics only. Fetch official HN metadata and actual article content; cite sources and distinguish comments. Left less/right more-and-save, accessible buttons/keys, undo, explain ranking, reset/export. Cache summaries, dedupe links, no LLM per swipe and no implicit refresh schedule.
+
## V17 Clone settings, library and on-demand ideas
+
+Area: ui. Depends on: V01, V05, V06, V10.
+
+Preserve all observed settings groups and library filters/search/sort/preview. Wire truthful supported controls, themes, shortcuts, dictation, devices, permissions and data export. Sandbox web artifacts. Original Vesper identity replaces Meta-specific account/plan text. Ideas only on request. Track unsupported integrations visibly; no dead controls presented as working.
+
## V18 Build Android navigation and shared client parity
+
+Area: android. Depends on: V01, V03, V10, V11.
+
+React Native/Expo development build renders mobile chat/drawers, four agent tabs, feed gestures, goals, library and settings using shared contracts. Validate reconnect/offline/cache state, keyboard/back gestures, screen reader and reduced motion. Emulator setup comes from official Android tools; no personal account login in test images.
+
## V19 Add Android alarms, assistant invocation and device capability checks
+
+Area: android. Depends on: V18.
+
+Implement native supported alarm/timer intents, permission-aware audio controls and default assistant service. Confirm outcomes instead of reporting intent dispatch as success. Validate locked/unlocked, denied permissions, battery restrictions and Nothing Phone invocation separately from emulator. No idle LLM/hotword loop unless explicitly requested.
+
## V20 Evaluate Google Messages and scoped phone automation
+
+Area: android. Depends on: V04, V05, V18.
+
+Validate current Google-account/emoji pairing and session expiry with authorized test use. Document phone connection and one-active-computer limitations. Separate notification listener/actions from general accessibility; inspect Google Play restrictions. No broad permission grant or message sending without explicit user action. Produce supported/experimental capability matrix.
+
## V21 Verify end-to-end reliability, isolation and visual parity
+
+Area: release. Depends on: V05, V07, V08, V09, V11, V12, V13, V14, V15, V16, V17, V19, V20.
+
+Exercise real configured harnesses with fake browser services, crash/restart, duplicate jobs, expired auth and approvals, malicious page content, vault leakage and offline devices. Demonstrate month-end calendar journey and zero idle model calls. Compare every required view and animation against reference; report gaps instead of passing placeholders.
+
## V22 Activate GitHub, Linear and Greptile review automation
+
+Area: workflow. Depends on: none.
+
+Finish account/app authorizations limited to Vesper where supported, no paid plan/overages. Verify GitHub required checks, Linear branch/PR linking and Greptile review on a test PR's latest SHA. Resolve comments through bounded babysitting. Record actual installations and any credit/eligibility limits; configuration alone is not activation.
+
## V23 Extend Muse integration catalog and wallet parity
+
+Area: integrations. Depends on: V03, V05, V17.
+
+Inventory every observed catalog entry against current official API/partner availability. Add eligible integrations in small PRs with permissions, reconnect and contract tests. Research wallet provider and approval requirements before transactions. This remains in full-parity scope; do not fake unavailable partner services or copy Meta account features.
+
## V24 Create original Vesper avatar and motion assets
+
+Area: ui. Depends on: V01.
+
+Create an original cute mascot with the reference's visual scale and warmth. Define idle/listening/thinking/error states, measured transitions and reduced-motion stills. Stop animation when hidden. Export licensed/original web and native assets; no copied Muse mascot or unnecessary GPU repaint loop.
+
