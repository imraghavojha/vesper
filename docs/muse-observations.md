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
| Messaging | Channel management includes WhatsApp. |
| Devices | Current and other devices with activity status. |
| Data controls | Training consent, memory import, agent-data download, destructive reset. |
| Wallet | Link by Stripe add control and disabled Shop Pay coming-soon row. No payment setup performed. |

## Synthetic acceptance journey

The following is fictional test data, not the user's account history. It preserves the product behaviors that future agents need to demonstrate.

1. Alex connects two example mailboxes and calendars. The UI labels each account and keeps writes scoped to the selected destination.
2. Alex adds a Canvas token for a fictional institution through the secure form. Vesper reports actual accessible capabilities and explains that a calendar feed contains less information than the course API.
3. Alex opens an employee scheduling site through its institution-specific SSO route. The flow may require an Employee choice and a short username instead of a full email address. A failed attempt pauses clearly rather than repeatedly retrying.
4. Alex requests a last-day-of-month check of the next month's shifts against a selected calendar. Existing calendar sync remains intact; the comparison proposes only missing or changed events.
5. Reauthentication pauses for user input when needed. A valid browser session is reused instead of deliberately logging out to test MFA.
6. An example school mailbox rejects API consent. A permitted browser session may be used, but a later expired session is shown as blocked rather than claimed successful.
7. Alex requests an Android alarm and an audio adjustment. The UI distinguishes a confirmed result, a dispatched request and an unsupported or failed action.
8. No unsolicited tips or unrequested monitoring follows. Only explicit schedules may start more work.

## Regression scenarios

A last-day intention must not become all dates 28 through 31. Goal descriptions, chat confirmations and Upcoming must derive from the same schedule. Test February, leap years and daylight saving changes. A stale daily title must not survive a change to monthly recurrence.

MFA success must be demonstrated by an actual result, not inferred from an assistant's claim. A prior successful login must not imply that a session is still valid today.

## Connector catalog

Observed catalog names, without retaining personal connection state: Browser, Canvas Custom, Gmail, Google Calendar, Google Contacts, Google Tasks, Apple Calendar, Apple Contacts, Apple Reminders, Calendly, Facebook, Finances via Plaid, Function Health, Google Docs, Drive, Forms, Sheets, Slides, Granola, HealthEx, Instagram, Instagram Messages, Messenger, Notion, OpenTable, Outlook Calendar, Outlook Contacts, Outlook Mail, Peloton, Philips Hue, Printify, Spotify, Tailscale, Tessie, Threads, Threads messages, Withings.

These are reference catalog names, not verified Vesper integrations. Prioritize the product specification and verify real API access. A catalog name does not establish access to a private partner API.

## Remaining evidence

Need direct Android app inspection, exact animation recordings, full expanded long-thread text, active browser takeover and navigation controls, pending approval state, search result behavior, and less common dialogs. Do not mark pixel/motion parity complete until this evidence exists. Settings Help/Legal and identity document contents need targeted inspection, without copying personal memory.

After native control timed out, the public Muse web entry was inspected as a fallback. It reached a sign-in/account-creation screen, not the existing conversation. No new Meta account was created. The page linked to Meta's design and security articles, which were read and added to the architecture research.
