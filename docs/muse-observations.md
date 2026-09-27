# Muse reference inspection

Inspected September 26–27, 2026. Reference is Muse 4.1 on the user's Mac, bundle `com.meta.endo`, and the existing Chrome tab at https://ai.meta.com/muse/. The native accessibility document calls itself Hatch. This record contains sanitized product observations, not a copy of the user's private chat.

## Evidence levels

Observed means visible in the native UI or website. Chat-reported means Muse said it happened; this inspection did not independently repeat the action. Proposed means Vesper behavior requested by the user or recommended in research. Do not convert chat-reported capability into a tested guarantee.

## Desktop layout

The first screenshot is 1152 × 768. Approximate column boundaries are x=75, x=305, and x=807. The icon rail is 75 px, chat sidebar about 230 px, conversation about 502 px, and agent panel about 345 px. These are measurements from one image, not fixed responsive breakpoints.

Near-black backgrounds, thin gray dividers, rounded dark message bubbles, white body text, muted secondary text, and bright blue user bubbles/controls define the interface. The left rail uses outline icons and an active circular background. The composer is a broad pill with add, input, microphone, and send. Main chat and unread dots sit above Channels and Side chats. A floating unread count sits above the composer. The right avatar occupies a pale circular frame with an edit affordance and name/status below. Four icon tabs share a pill-shaped track.

Settings uses an 800 × 600 window. The left navigation is about 225 px wide; content begins around x=249. Rows and groups use rounded gray cards. Secure Store lists domains with favicons and chevrons. Add opens a three-row URL/Username/Password form, with blue focus ring, password reveal, and bottom-right Cancel/Add buttons. Add is disabled when blank.

Screenshots were captured inline during inspection, not dumped into a repository folder. Initial captures were frozen despite accessibility state changing; those repeated frames are not evidence of the selected tabs. Capture recovered after the user made the window available. Exact motion timing has not been measured.

## Views inspected

| View | Observed details |
| --- | --- |
| Main chat | Onboarding name selection, app connection cards, messages, reactions, reply/copy controls, attachment/dictation composer, unread count, side-chat list. |
| Activity | Date groups, task titles, short results, timestamps, separate successful and blocked entries. |
| Approvals | History includes task-only sensitive-site access, saved-credential filling, and persistent site permission. Expandable approval details. |
| Upcoming | Reminders, Daily, Monthly groups. An agentic feature tour and a 30-minute Heartbeat are present. |
| Identity | Name/edit and SOUL/MEMORY document buttons with dates and access warning. |
| Feed | Editions by time of day; editorial summaries, source links, media, Love, Discuss, per-card options, editable feed instructions. Includes personal data and broad topics that Vesper will exclude by default. |
| Ideas | Featured suggestions and categories including productivity, finance, health, shopping, relationships. Vesper retains layout but generates only on request. |
| Goals | Tracking list with completion checkboxes, summary, options, creation categories. Detail shows description, associated scheduled file, and activity timeline. |
| Library | Search, All artifacts, Documents, Web artifacts, Images, Videos, Podcasts, System files, sort/select/create and empty state. |
| General settings | Account, usage, upgrade, invitation code, language, appearance, theme colors, startup, menu bar, floating button, Quick Chat shortcut, version/update. |
| Computer use | Accessibility and Screen Recording status, keep-awake switch, computer/browser approval defaults, blocked apps. |
| File system | Full Disk Access status, individual Mail/Messages/Notes/WhatsApp toggles, blocked folders. |
| Dictation | Microphone/accessibility, input device, automatic send, audio cues, push-to-talk and hands-free shortcuts. |
| Secure Store | Domain list and separate masked credential entry form. No saved password was opened or copied. |
| Permissions | Connector/web defaults, persistent grants, connector/app/file/site/artifact/task/network categories, reset. |
| Messaging | Connected WhatsApp channel. |
| Devices | Current Mac and a Nothing Phone shown active. |
| Data controls | Training consent, memory import, agent-data download, destructive reset. |
| Wallet | Link by Stripe add control and disabled Shop Pay coming-soon row. No payment setup performed. |

## Initial main-thread case study

The native accessibility tree exposed the main conversation from onboarding through the latest updates. Several long offscreen messages were truncated, so this is not a full verbatim export. Passwords appeared in historical chat; they were not retained in project documents, test fixtures, or external tickets. Treat the original conversation as private and use synthetic examples.

1. Muse named the assistant, then connected two Gmail accounts, Google Calendar, Contacts, and Tasks. Microsoft mail OAuth was denied.
2. Canvas began with a calendar feed. The conversation then added a personal access token through a secure form and corrected the institution base URL. Muse reported API access to courses, assignments, submissions, grades, announcements, modules, and files.
3. SubItUp discovery used a link in a Canvas course. Initial SSO attempts confused full email with short institutional username. Employee account selection and the short username mattered. Muse later reported a successful shift read.
4. The user changed daily reconciliation to a month-end comparison of the whole next month. Existing calendar sync should remain the primary source, with reconciliation correcting gaps.
5. Muse repeatedly tested login/MFA until the user told it to stop and reuse the saved session. Automatic Duo approval was discussed but not convincingly proven. The final fallback was notification when manual input is needed.
6. Outlook used a separate secure capture for Microsoft's login origin. Muse reported a successful inbox summary, but a later activity entry says inbox reading was blocked. Browser login is not universally reliable.
7. Side chats cover an alarm, alarm volume, and reminders/calendar events. Activity distinguishes a reportedly scheduled alarm from a failed volume change.
8. Muse sent unrequested tips and personal suggestions afterward. Vesper explicitly omits this behavior.

## Inconsistencies to turn into tests

The SubItUp goal description still says every morning. Its later timeline says monthly last-day. Upcoming and the goal summary show September 28 as next run. The associated filename encodes days 28,29,30,31. That visible mismatch is sufficient to require a calendar-aware month-end test; it does not prove how Muse's internal scheduler actually executes.

Never copy the stale daily title/description into Vesper. Derive display text and next execution from a canonical schedule. Preserve a factual outcome log rather than asserting automatic MFA worked because a timeline entry says so.

## Connector catalog observed

Connected: Browser, Canvas Custom, Gmail, Google Calendar, Google Contacts, Google Tasks.

Available rows: Apple Calendar, Apple Contacts, Apple Reminders, Calendly, Facebook, Finances via Plaid, Function Health, Google Docs, Drive, Forms, Sheets, Slides, Granola, HealthEx, Instagram, Instagram Messages, Messenger, Notion, OpenTable, Outlook Calendar, Outlook Contacts, Outlook Mail, Peloton, Philips Hue, Printify, Spotify, Tailscale, Tessie, Threads, Threads messages, Withings.

These are Muse catalog entries, not verified reusable integrations. Prioritize the integrations in the product specification. Do not imply Vesper can obtain private partner access merely by copying the list.

## Remaining evidence

Need direct Android app inspection, exact animation recordings, full expanded long-thread text, active browser takeover and navigation controls, pending approval state, search result behavior, and less common dialogs. Do not mark pixel/motion parity complete until this evidence exists. Settings Help/Legal and identity document contents need targeted inspection, without copying personal memory.

After native control timed out, the public Muse web entry was inspected as a fallback. It reached a sign-in/account-creation screen, not the existing conversation. No new Meta account was created. The page linked to Meta's design and security articles, which were read and added to the architecture research.
