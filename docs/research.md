# Technology research

Research date: September 26–27, 2026. Recommendations are design judgments; links establish the underlying capabilities. Nothing here claims the application has been built or its backend tested.

Read [architecture and concrete reuse](architecture-and-reuse.md) for the deeper source-level assessment, including T3's Effect prerelease dependency, browser settings that must change, specific reusable packages, and a tested Croner experiment. That document refines this initial shortlist.

## Recommended stack

| Area | Choice | Reason and boundary |
| --- | --- | --- |
| Mac | Electron, React, TypeScript, Vite | Chromium-backed embedded browser and native desktop integration outweigh the larger runtime for this project. |
| Android | React Native, Expo development builds, Kotlin modules | Shares state/contracts with React while preserving native gestures, assistant service, alarms, and permissions. Expo Go alone is insufficient. |
| Shared UI foundations | Design tokens, icons, state selectors, accessibility semantics; web/native components where necessary | Avoid promising one DOM implementation can produce native assistant and browser behavior. |
| Host | Node.js 24 LTS, TypeScript, Effect for scoped services and typed errors | Closely follows the inspected T3 architecture. Keep the domain smaller than T3; do not transplant its whole server. Pin exact compatible versions in the bootstrap issue. |
| Persistence | SQLite WAL, migrations, transactional commands, append-only run/approval audit | Simple for one host. A durable jobs table and outbox can meet initial requirements without operating a cluster. |
| Transport | Typed request/event protocol with reconnect cursors | Shared contracts prevent web/mobile/provider divergence. Authenticate pairing; bind local server to loopback by default. |
| Browser | Electron WebContentsView plus a restricted automation broker | Same visible session for user and agent. Isolated account partitions, explicit takeover, and persistent state. |
| Credentials | OS-backed encrypted vault plus isolated broker | macOS Keychain-backed encryption; Android Keystore. Encryption alone does not keep an unrestricted same-user agent from reading secrets. |
| Tests | Vitest for domain/adapters; Playwright for web/Electron; native Android instrumented tests and emulator journeys | Tests assert outcomes, replay, failure, isolation and permissions. Visual tests use synthetic data. |
| Feed | Official HN API, cached extraction, Readability where appropriate, simple explicit-feedback ranking | Low cost and explainable. Summarize only fetched content; swipes need no model. |

Electron's [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view) hosts page contents. Its [security guidance](https://www.electronjs.org/docs/latest/tutorial/security) requires special care with untrusted pages. Disable Node integration, enable isolation and sandboxing, validate IPC senders, control popup/navigation/permissions, and do not expose app APIs to remote pages. Tauri is attractive for footprint, but a cross-platform OS-webview automation layer adds risk to this project's highest-priority feature. React Native macOS would also require a larger bespoke browser/control layer. These are tradeoffs, not impossibility claims.

## T3 Code, inspected directly

Pinned reference commit: `ab099178a7b7f9728843e90fc95ed90bb61d710d` of [pingdotgg/t3code](https://github.com/pingdotgg/t3code/tree/ab099178a7b7f9728843e90fc95ed90bb61d710d). A temporary read-only checkout was used outside Vesper. Do not copy its private live application data.

The repository's [AGENTS.md](https://github.com/pingdotgg/t3code/blob/ab099178a7b7f9728843e90fc95ed90bb61d710d/AGENTS.md) describes a Node WebSocket server, provider subprocess adapters, Electron desktop, React Native mobile, typed contracts, shared client runtime, durable events, projections and queued side effects. Adopt the separation and typed receipts, not every subsystem. Its [t3.json](https://github.com/pingdotgg/t3code/blob/ab099178a7b7f9728843e90fc95ed90bb61d710d/t3.json) runs worktree setup automatically. Its review guidance asks for focused changes, meaningful backend tests, uploaded UI evidence, and a babysitting loop that rechecks bot findings against code.

The checked commit has Node `^24.13.1`, pnpm `11.10.0`, Vite+, Effect, extensive CI, and a CodeRabbit configuration. Vesper should use ordinary GitHub-hosted runners initially, rather than copy T3's paid Blacksmith runner labels. A sampled recent [PR 13887](https://github.com/pingdotgg/t3code/pull/13887) contains Macroscope reviews. This establishes actual bot use, not a universal sponsor list or a claim every PR has identical checks.

No standalone babysitting skill was found in the checked T3 `.agents/skills` directory. Its published rule is in AGENTS.md. Vesper's small skill is original and based on that observable workflow. The public repository does not establish Theo's entire private or latest personal setup.

High-value source references:

- `apps/server/src/provider/Services/ProviderAdapter.ts` and provider adapters for normalized capabilities and lifecycle.
- `packages/contracts` and `packages/client-runtime` for schema/client separation.
- `apps/desktop/src/preview/BrowserSession.ts`, `WebviewPreferences.ts`, `Manager.ts` and their tests for browser lifecycle and isolation.
- `apps/server/src/orchestration` for persisted events and completion receipts.
- `scripts/setup-worktree.ts`, `.github/workflows/ci.yml`, and `.github/pull_request_template.md` for worktree and review practice.

Do not copy browser cookie import or provider credential handling wholesale. Vesper has a different trust boundary: agents can read personal services and fill secrets. Upstream MIT attribution is required for copied portions.

## Provider integration and context cost

Use a provider adapter with discoverable models, authentication status, start/resume/cancel, streamed events, approvals, tool capability flags, usage, and a clear unsupported state.

- Codex: [App Server](https://developers.openai.com/codex/app-server/) supports rich client integration and persistent streamed interaction. [Noninteractive exec](https://developers.openai.com/codex/noninteractive/) is suitable for bounded jobs. The local machine has a `codex` executable, but no model call was made during research. A T3 Chat subscription is not assumed to be an API key or a transferable entitlement.
- OpenCode: its [server API](https://opencode.ai/docs/server/) is the integration boundary. The local binary exists. Discover the user's configured models without printing credentials or reading unrelated T3 databases. Test reconnect and session cancellation.
- Antigravity: the [official ACP registry entry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json) and [T3 provider guide](https://github.com/pingdotgg/t3code/blob/ab099178a7b7f9728843e90fc95ed90bb61d710d/docs/user/providers-antigravity.md) establish a supported adapter path. Account/model access is provider-controlled. No `antigravity` binary was on the inspected shell PATH; T3-managed installation may exist elsewhere and was not probed.

The smallest useful prompt includes task intent, relevant identity/memory, recent conversation, and a compact capability index. Retrieve tool schemas and connector instructions only when selected. Bound and summarize large results; keep full results outside context behind IDs. Cache article summaries and stable tool descriptions. Report input/output/tool tokens per run and stop at configured step/time/cost limits. Do not strip necessary consent or safety context to win a token benchmark.

An exec-only provider may supply its own large system instructions or tool definitions. Vesper cannot honestly promise control of every provider's internal prompt. Measure actual usage through each adapter. Keep Vesper tools small and do deterministic sync, ranking and scheduling without an LLM. No prompt-only rule can safely constrain a provider launched with unrestricted access to the vault's operating-system account.

## Browser and credential boundary

The model asks to fill a credential by opaque ID. A trusted component validates the run, approved origin, account, field and current navigation, then injects the secret without returning it. It redacts captured values and audit payloads. Approval binds to a hash/version of the intended action. A changed destination invalidates the grant.

Browser profiles and vault data must be outside the model execution sandbox. If the provider's shell can read those files, debug the browser, intercept IPC, or invoke arbitrary JS after filling, the claim that it cannot read secrets is false. The first browser spike must prove the isolation boundary, including iframe/redirect/DOM leakage. Separate OS identity, sandbox or VM is a candidate; a second process alone is not an adequate guarantee.

Store session cookies as sensitive data. Block secret-bearing network/DOM debug output and keep downloaded page instructions untrusted. MFA waits have deadlines and clear recovery. Browser errors and expired sessions are normal product states.

## Calendar, mail and custom services

[Google Calendar incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync) uses persisted sync tokens and a full resync after invalidation. Track cursors per account/calendar; commit a new cursor only after all pages. Calendar event writes use source IDs and conditional updates to avoid duplicates and overwriting manual edits.

[Gmail sync](https://developers.google.com/workspace/gmail/api/guides/sync) supports full and history-based partial synchronization. Add pagination, expired-history recovery and token refresh tests. Public distribution needs the appropriate OAuth consent and verification work for requested scopes. Use official native-app OAuth flows, not credential capture for Google OAuth inside an embedded user agent.

[Canvas documentation](https://developerdocs.instructure.com/services/canvas) defines the API, authentication and endpoint capabilities. A personal token is tied to a user and institution. A calendar feed is not a replacement for course/submission data. Show the actual API capabilities and handle 401/403/rate limits and pagination.

[Microsoft Graph authentication](https://learn.microsoft.com/en-us/graph/auth/auth-concepts) depends on application permissions and tenant consent. Browser fallback uses the user's permitted session; it does not bypass school policy.

[SubItUp's support guide](https://support.subitup.com/how-to-sync-your-personal-calendar-to-subitup) describes one-way employee shifts into Google/Outlook calendars. Its [integration page](https://www.subitup.com/solutions/integrations/) describes enterprise integrations and SSO. Research did not establish a generally available employee personal API token. Preserve calendar sync and use authorized browser reading for discrepancy checks. Do not treat Muse's claim of a partner-only API as independently proven.

## Android feasibility

[VoiceInteractionService](https://developer.android.com/reference/android/service/voice/VoiceInteractionService) is a native service selected by the user. The system keeps that service available, so its idle path must be lightweight and must not run a model. Power-button routing remains OEM-dependent.

[AlarmClock intents](https://developer.android.com/reference/android/provider/AlarmClock) provide supported alarm/timer requests. Test the chosen clock app and distinguish dispatch from confirmation. AudioManager changes and Do Not Disturb interactions need their own device validation.

[WorkManager](https://developer.android.com/develop/background-work/background-tasks/persistent) persists deferrable work across restarts and respects power management. It is not an exact alarm or a guarantee of an always-running model. Use a reachable host for durable remote work; use local native alarm APIs for clock behavior.

Google Play's [AccessibilityService policy](https://support.google.com/googleplay/android-developer/answer/10964491) restricts autonomous initiation/planning/execution through accessibility. This is a distribution constraint, not merely a missing React Native package. The product needs a supported-intents baseline and a separately evaluated experimental automation mode.

[Google Messages for web](https://support.google.com/messages/answer/7611075) requires device pairing and phone connectivity. The current support page describes Google-account/emoji pairing and says QR pairing is unavailable in the US. It documents one active computer and eventual unpairing. Do not build around outdated QR-only assumptions or promise a personal RCS API.

## Open-source reuse shortlist

GitHub metadata sampled September 27, 2026. Stars indicate adoption, not quality or fit. Inspect the exact files and licenses before copying; counts drift.

| Repository | Approx. stars | License reported | Use and constraint |
| --- | ---: | --- | --- |
| [T3 Code](https://github.com/pingdotgg/t3code) | 23.6k | MIT | Reference provider adapters, client contracts, browser tests and worktree workflow. Avoid a wholesale fork of the coding product. |
| [Playwright](https://github.com/microsoft/playwright) | 96.7k | Apache-2.0 | Browser testing/automation patterns and locator behavior; evaluate Electron limitations. |
| [browser-use](https://github.com/browser-use/browser-use) | 116k | MIT | Study browser action extraction and evaluations; Python dependency and agent loop may duplicate Vesper providers. |
| [OpenCode](https://github.com/anomalyco/opencode) | 210k | MIT | Provider integration via supported server API, not source transplant. |
| [Temporal](https://github.com/temporalio/temporal) | 23.3k | MIT | Strong durable-workflow reference. Revisit for multi-host reliability; operational overhead is unnecessary for the initial single host. |
| [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) | 16.4k | Apache-2.0 reported | Candidate for hosted scheduled jobs; verify subcomponent licenses and deployment cost before adoption. |
| [Expo](https://github.com/expo/expo) | 52.5k | MIT | Native development builds, module integration and mobile lifecycle. |
| [Readability](https://github.com/mozilla/readability) | 11.5k | Apache-2.0 | Article extraction only; sanitize content and do not treat extraction as permission to republish entire articles. |
| [Nango](https://github.com/NangoHQ/nango) | 12.4k | Mixed/NOASSERTION | Evaluate OAuth/connector operations later; license and hosted/self-hosted boundaries need file-level review. |
| [Mastra](https://github.com/mastra-ai/mastra) | 28.4k | Mixed/NOASSERTION | Evaluate only if provider orchestration requirements justify another framework. Not needed to wrap existing agent runtimes initially. |

The [official Hacker News API](https://github.com/HackerNews/API) provides story metadata and comment IDs; full article text still comes from the linked publisher. Popularity signals must be filtered by the user's explicit topics.

## Review services

The user said “reptile”; Greptile is the likely intended product. Its [current pricing](https://www.greptile.com/pricing) advertises a free Starter tier with 50 monthly credits for one active developer, and a separate application for qualifying noncommercial MIT/Apache projects. Credits and eligibility are not guaranteed for this account. Do not subscribe or enable overages to finish setup.

Theo's live [sponsor page](https://t3.gg/sponsors) was also inspected in Chrome. It lists CodeRabbit, Greptile and Macroscope, plus Browserbase and Blacksmith. The [Greptile sponsor detail](https://t3.gg/sponsors/greptile) links to a referral destination but does not show a specific free-credit offer. Sponsor status is verified; extra credits beyond the vendor's published plan are not.

[Greptile configuration](https://www.greptile.com/docs/code-review/greptile-json-reference) supports per-repository triggers, draft behavior, review effort, and custom instructions. Vesper uses base review effort, no draft reviews and no automatic fixes. Configuration does not install the GitHub App.

Its [Linear integration](https://www.greptile.com/docs/linear-integration) reads issue context and needs admin authorization. Limit teams rather than grant an entire unrelated workspace. GitHub's Linear integration should link issue identifiers in branch/PR names and update workflow state. Confirm actual installation and webhook behavior before calling this automated.
