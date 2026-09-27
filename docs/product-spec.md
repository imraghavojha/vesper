# What we are making

Vesper is a publicly releasable personal assistant for one person's real daily work. It remembers conversations, operates a browser the person can see and take over, connects accounts, tracks goals, and runs explicitly scheduled jobs. It starts with macOS and Android, synced through an independent shared host. Scheduled work and shared services continue when the Mac is off. React powers the desktop UI; React Native powers mobile.

The target is Muse's layout and interaction model with Vesper branding and an original cute avatar. This is a product specification, not a step-by-step implementation plan. The research document records recommended technologies and unresolved choices.

Interchangeable agent harnesses are a core feature. The composer and schedule editor expose Codex, Claude, OpenCode, Antigravity and custom adapters, with eligible existing subscriptions where supported. See [provider requirements](providers.md). Vesper is its own application assembled from reused components and selected code, not a whole-product fork.

## Product rules

- No heartbeat that wakes a model to look for something to do. No unsolicited productivity tips or inferred monitoring subscriptions.
- Runs start from a user request, an enabled schedule, or an event trigger the user explicitly configured. Transport keepalives and deterministic sync are not model runs.
- Every run shows its cause, account, status, outcome, and relevant approval. Failure and uncertainty must remain visible.
- The browser and secure login flow are first-class product features. A demo chat shell without these is not a working Vesper.
- Credential capture and filling use trusted app code and OS-encrypted storage. Secrets stay out of chat, prompts, model-visible tool output, screenshots, analytics and review artifacts. Use a shared vault accessible from both clients, with tested host and worker access controls.
- Multiple accounts are separate identities. Every write names the destination account and calendar/mailbox.
- Desktop and mobile share meaning and state. They need not force identical components across DOM and native rendering.

## Navigation and chat

Desktop has a narrow icon rail, a resizable chat sidebar, a main conversation, and a right agent panel. The rail preserves Chat, Search, Feed, Ideas, Goals, Library, and Settings. Mobile presents the same destinations through drawers and sheets. Exact mobile geometry still needs direct Muse Android inspection.

Main chat is persistent. Side chats have their own history, names, unread indicators, search, and context boundaries. Side-by-side chat remains accessible from Feed, Ideas, Goals, and Library. A channel conversation is visibly distinguished from an editable Vesper chat.

Messages support streaming, markdown, code, links, images, files, tool cards, replies, copy, reactions, retry, cancel, and an unread/jump-to-latest control. The composer supports attachments and dictation. A running action does not become a successful chat message until a corresponding result exists.

Search covers chats, messages, goals, reminders, and library items with type filters and deep links. Private connector content is searched only within connected accounts and user-granted scope. Credentials are never indexed.

## Right agent panel

An original soft, rounded mascot sits above its editable name and connection status. Match the reference's scale and placement. Give Vesper its own silhouette, face, palette, and animation assets. Avatar motion stops when hidden and respects reduced motion.

| Tab | Required behavior |
| --- | --- |
| Activity | Group runs by date. Show action, brief outcome, time, running/blocked/succeeded/failed state. Open execution details, browser evidence, and related goal. |
| Approvals | Pending queue and history. Explain action, destination, account, data, and permission scope. Allow once, allow a named scope, deny, and revoke saved grants. Never let a stale approval authorize changed arguments. |
| Upcoming | Reminders plus scheduled jobs, grouped by recurrence. Show next run in the user's timezone, edit, pause, resume, snooze, cancel, and inspect last result. No Muse heartbeat or feature-tour schedule. |
| Identity | Edit assistant identity and user-approved memory. The reference labels its documents SOUL and MEMORY. Show provenance, revision history, and forget/export controls. Memory is context, not an authority to perform new actions. |

## Shared browser and secure store

The user can open tabs, navigate back/forward, enter URLs, see loading/error state, and take over from the agent. Agent and user see the same task browser session. Each run indicates whether it uses the Mac, a remote host, or the phone. One controller owns input at a time; user takeover pauses agent input immediately.

Persist sessions per account/profile. Offer clear session, sign out, reconnect, and revoke access separately from deleting the conversation. Preserve session cookies through ordinary restarts. Do not copy the user's entire Chrome profile as a shortcut.

The secure store contains domain/account records. Its add form has URL, Username, masked Password, reveal control, Cancel, and Add. Custom tokens use a similar dedicated secure form. A chat card can request a credential; submission resumes the waiting run without putting the secret in the transcript. Display domain, account label, last use, and revoke/delete controls without exposing the value.

Credential use is constrained to the approved HTTPS origin, account, task, and operation. SSO redirects require explicit origin relationships. Hostname substring matching is insufficient. Requests to inspect credential fields, cookies, authorization headers, or the vault through arbitrary scripts are denied or redacted by the broker. Browser downloads and generated artifacts are isolated from executable app code.

MFA and reauthentication have a visible waiting state and a user takeover path. Preserve a valid session instead of logging out repeatedly to prove automation. Never guess which notification action approves authentication. Automatic phone approval is an experimental, separately authorized capability, not a launch guarantee.

## Integrations

| Integration | Product commitment |
| --- | --- |
| Google Calendar | Multiple accounts and calendars, agenda, conflict checks, create/update/cancel, recurrence, timezone display, source-aware reconciliation. |
| Gmail | Multiple mailboxes, search/read threads, attachments, labels, drafts, explicit sending approvals, clear sending identity. |
| Google Contacts and Tasks | Lookup and task management where authorized; connect them to recipient resolution and goals. |
| Canvas | Institution-specific base URL plus securely entered token; courses, assignments, submission status, announcements, available grades and course materials. Show actual token permissions and unsupported endpoints. |
| SubItUp | Employee login and SSO route, saved browser session, next-month shift comparison on the actual last calendar day. Prefer its existing calendar feed; reconcile gaps without duplicates or changes to employee shifts. |
| Outlook | Microsoft Graph where the tenant permits it; browser login fallback for a permitted school account. Browser access does not override organization restrictions. |
| Google Messages | Experimental paired Messages for web session. Explain phone connectivity, pairing expiration, one-active-computer limits, and sending approval. Do not promise an official general personal-message API. |
| Additional Muse catalog | Inventory retained in the observation record. Add by real user demand and verified API access. A catalog entry must distinguish available, connected, unavailable, and planned. |

Integration settings show accounts, permissions, last sync, errors, reconnect, disconnect, and data deletion. A custom integration records its base URL, auth method, capability list, scopes, schedule, and test result. Agent-generated connector code is reviewed and sandboxed before recurring execution.

## Schedules, reminders, and goals

Goals contain a title, description, status, related tasks, approved monitoring rules, and an activity timeline. Support complete/reopen, pause/resume, edit, and archive/restore. A goal alone does not authorize indefinite background work.

An enabled schedule contains one canonical recurrence, timezone, next run, target account, permissions, retry policy, and run budget. Its description and next-run display derive from that same record. A monthly last-day rule fires once on February 28 or 29 and once on months ending in 30 or 31. It must not mean all of days 28 through 31.

Jobs survive restarts. They use durable claims and idempotency keys. A duplicate delivery must not duplicate calendar events or send another email. The UI distinguishes an on-time run, missed run, deferred run, authentication block, failure, and cancellation. When the host is asleep or offline, the user sees the missed-run policy. An independent reachable host is required so scheduled agent work can continue while the Mac is off. Mobile is not an always-on desktop-harness server.

The representative acceptance journey is a monthly SubItUp check: compare the next month's posted shifts with a selected calendar, propose the exact discrepancy set, apply only permitted changes, record provenance, and notify only for configured outcomes or a blocker.

## Feed and ideas

Feed retains Muse's editorial cards, edition/date grouping, source links, save/love, and Discuss action. Its initial scope is AI and coding from Hacker News. Connected email, grades, or personal tasks do not leak into Feed by default.

Each card shows a short grounded summary, title, source domain, publication/retrieval time, HN discussion link, and why it was selected. Left swipe means less like this. Right swipe means more like this and save. Provide visible buttons, keyboard equivalents, and undo. Store explicit topic/source feedback locally and make reset/export available. Begin with understandable ranking weights and limited exploration within selected topics. No model call is needed to record a swipe.

Deduplicate URLs, cache extraction and summaries, mark inaccessible articles, distinguish article facts from HN comments, and never invent summaries of unread pages. Feed refresh occurs on request or an explicit schedule. Ideas is a user-requested suggestion board with accept/dismiss, not a background suggestion engine.

## Library and settings

Library preserves All artifacts, Documents, Web artifacts, Images, Videos, Podcasts, and System files with search, sort, selection, preview, and chat links. Generated web artifacts run in a restricted frame/origin. File operations expose scope and provenance.

Settings preserve the observed groups: General, Connectors, Computer use, File system access, Dictation, Wallet, Secure Store, Permissions, Messaging channels, Devices, Data controls, Help and support, Legal info. General includes light/dark/system mode, accent/avatar theme, language, startup, menu bar, floating access, shortcuts, and version. Vesper adds Providers and run budgets.

Wallet stays outside the first usable release. Do not present a working payment integration until an actual provider and approval flow exist. Meta account, Meta subscriptions, invitation codes, and training consent are replaced with Vesper-relevant account/provider and privacy controls. Default training/telemetry consent is off. Purchases and regulated services are not acceptance requirements for the initial personal assistant.

## Android

React Native screens preserve chat, side chats, feed swipes, goals, library, agent panel, and settings. Use native modules for secure storage, notifications, alarm/timer intents, audio controls where permitted, and default-assistant registration.

Power-button invocation depends on the phone manufacturer and user-selected assistant settings. Validate on the user's Nothing Phone as well as an emulator. Do not equate a passing emulator test with support for every OEM. Launching Clock, requesting an alarm, and proving an alarm exists are different states and must be reported honestly.

Notification reading, notification actions, and general accessibility automation are separately opt-in capabilities. A Google Play build must satisfy the current accessibility policy. A private experimental build may explore broader device automation, but must retain scoped consent, visible execution, and cancellation. No silent lock-screen or biometric bypass.

## Fidelity and release acceptance

Every cloned view needs empty, populated, loading, error, disconnected, and relevant permission states. Check keyboard use, focus, screen readers, reduced motion, long text, window resizing, and Android back navigation.

Use reference screenshots at matched dimensions for layout and short recordings for motion. Record duration, easing, interruption behavior, and reduced-motion behavior before claiming exact animation parity. Current screenshots establish some static geometry; they do not establish exact animation timing.

A usable release completes real browser login with a fake test account, chat through a real configured provider, durable approval/resume, a test calendar reconciliation, an explicit scheduled job with zero idle model calls, and matching results on Android. Run live-provider smoke tests only with the user's authorized accounts; CI uses synthetic fixtures.

## Public release quality

Install and update both apps without losing workspace data. Failed updates, expired connections and interrupted jobs have clear recovery paths. Backups can actually be restored. A browser or provider failure does not take down chat or scheduled work. Supported app/provider versions remain compatible, and incompatible versions offer an understandable update path. The product must be maintainable and tested, not merely the smallest prototype.
