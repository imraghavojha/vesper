# Product backlog

The [Linear project](https://linear.app/imraghavojha/project/vesper-d4bae716cdc0/overview) tracks what Vesper must do. Issues describe outcomes and acceptance, not code structure or implementation. Architecture decisions live separately in the research documents.

This page is generated from [backlog.json](backlog.json). Dependencies below express product prerequisites; native Linear blocking relationships are not configured.

## V01 Define the complete Muse experience Vesper must match

[IMR-5](https://linear.app/imraghavojha/issue/54e9dd94-32af-41b0-ae86-b77961394faa) · Area: reference. Prerequisites: none.

An agreed product reference covers every Muse screen, navigation destination, dialog, gesture and animation on Mac and Android. It identifies populated, empty, loading, error and permission states, original Vesper branding, accessibility expectations and explicit Vesper differences. Remaining reference gaps are visible so later feature work has a clear target.

## V02 Use Vesper on Mac and Android with one shared workspace

[IMR-6](https://linear.app/imraghavojha/issue/985f227d-b01a-462c-b544-2fff3d773368) · Area: foundation. Prerequisites: none.

A user can install and use Vesper on a Mac without owning a phone or configuring a separate host, or connect the Mac to an existing shared workspace. Local work pauses when the Mac is off; work on an independent host remains available. Android is the primary everyday assistant when paired, but is optional for Mac use. Paired Mac and Android devices show the same workspace, account and connection status. Setup explains device-specific and offline limits. Restarting either app preserves its workspace.

## V03 Keep conversations, settings and actions consistent across devices

[IMR-7](https://linear.app/imraghavojha/issue/24bb5e81-16e1-4e90-9126-46d9eff5791e) · Area: foundation. Prerequisites: [IMR-6](https://linear.app/imraghavojha/issue/985f227d-b01a-462c-b544-2fff3d773368).

Messages, side chats, goals, reminders, activity, approvals, identity and settings stay consistent across Mac and Android. Reconnecting restores missed updates without duplicates. Simultaneous edits have an understandable result. An action approved, cancelled or completed on one device is reflected on the other.

## V04 Use one shared signed-in browser from Mac and Android

[IMR-8](https://linear.app/imraghavojha/issue/553b84e6-e92d-4d90-979f-7f557f78717e) · Area: browser. Prerequisites: [IMR-6](https://linear.app/imraghavojha/issue/985f227d-b01a-462c-b544-2fff3d773368), [IMR-7](https://linear.app/imraghavojha/issue/24bb5e81-16e1-4e90-9126-46d9eff5791e).

User and agent can use the same browser task and saved login session from either device. Show tabs, navigation, loading and failures. User takeover immediately pauses agent input. Accounts remain separate, sessions survive restart, and the user can clear one session without clearing others. The browser clearly identifies where it is running.

## V05 Save and manage shared website logins and custom tokens

[IMR-9](https://linear.app/imraghavojha/issue/2175c734-16a1-493d-b0f6-e94b420d686d) · Area: browser. Prerequisites: [IMR-5](https://linear.app/imraghavojha/issue/54e9dd94-32af-41b0-ae86-b77961394faa), [IMR-8](https://linear.app/imraghavojha/issue/553b84e6-e92d-4d90-979f-7f557f78717e).

Add, update and remove credentials from Mac or Android and use them for authorized tasks started from either device. Preserve Muse's separate secure-entry form and resume a waiting task after submission. Keep passwords/tokens out of conversation and activity content. Show domain/account, locked or unavailable state, revocation and recovery. Saved logins belong to the shared workspace rather than one device.

## V06 Choose an agent, account and model for each conversation or schedule

[IMR-10](https://linear.app/imraghavojha/issue/bb2e04b0-4d29-4eb6-b3da-edb838ca8ec2) · Area: providers. Prerequisites: [IMR-7](https://linear.app/imraghavojha/issue/24bb5e81-16e1-4e90-9126-46d9eff5791e).

The user can select a supported harness, account and model without leaving Vesper. Show availability, capabilities, usage limits and errors. Switching preserves visible conversation, files and goals, and clearly explains continuation limits. Do not silently switch accounts, use a paid fallback or carry an old approval into a changed action.

## V07 Use Codex as Vesper's agent

[IMR-11](https://linear.app/imraghavojha/issue/f84340ba-d4a9-41b0-9608-bbd0384892e8) · Area: providers. Prerequisites: [IMR-10](https://linear.app/imraghavojha/issue/bb2e04b0-4d29-4eb6-b3da-edb838ca8ec2), [IMR-8](https://linear.app/imraghavojha/issue/553b84e6-e92d-4d90-979f-7f557f78717e).

Connect an eligible existing Codex account or supported API configuration. Chat, use Vesper's browser and connected services, approve or deny actions, stop work and resume conversations. Show streaming progress, model selection and usage-limit/authentication errors consistently on Mac and Android.

## V08 Use Claude as Vesper's agent

[IMR-12](https://linear.app/imraghavojha/issue/68b2b780-4a4c-4013-b4c3-22c827e921b7) · Area: providers. Prerequisites: [IMR-10](https://linear.app/imraghavojha/issue/bb2e04b0-4d29-4eb6-b3da-edb838ca8ec2), [IMR-8](https://linear.app/imraghavojha/issue/553b84e6-e92d-4d90-979f-7f557f78717e).

Connect Claude through a supported account or API option. Chat, use connected services and the shared browser, answer questions, approve or deny actions, stop work and resume where supported. Show actual model eligibility and usage limits. Never silently change billing or claim unavailable subscription access.

## V09 Use OpenCode and Antigravity as Vesper agents

[IMR-13](https://linear.app/imraghavojha/issue/5a84dcce-b149-4dbd-9ea9-728a397121e1) · Area: providers. Prerequisites: [IMR-10](https://linear.app/imraghavojha/issue/bb2e04b0-4d29-4eb6-b3da-edb838ca8ec2), [IMR-8](https://linear.app/imraghavojha/issue/553b84e6-e92d-4d90-979f-7f557f78717e).

Choose OpenCode or Antigravity, select available accounts/models, and use the same Vesper chat, browser, approvals and connected services. Preserve resumable history where supported and clearly label unsupported features. Authentication failure, quota limits and cancellation have honest, recoverable states.

## V10 Use main chat, side chats and search like Muse

[IMR-14](https://linear.app/imraghavojha/issue/2ea97df0-575d-4df9-9af5-9bff585661e9) · Area: ui. Prerequisites: [IMR-5](https://linear.app/imraghavojha/issue/54e9dd94-32af-41b0-ae86-b77961394faa), [IMR-6](https://linear.app/imraghavojha/issue/985f227d-b01a-462c-b544-2fff3d773368), [IMR-7](https://linear.app/imraghavojha/issue/24bb5e81-16e1-4e90-9126-46d9eff5791e).

Match Muse's rail, chat sidebar, main conversation, composer, unread indicators and side-by-side chat. Support real streamed replies, attachments, dictation, message replies, copy, reactions, cancel/retry and named side chats. Search finds relevant conversations and items. History and unread state remain consistent across devices. Mac-only users can invoke a compact quick chat near the notch or top of the display with a global shortcut or menu-bar action, speak with explicit recording controls, and receive text replies using the same conversation and provider. Full and quick windows preserve drafts and active runs. Shortcut conflicts are visible and never change another app’s settings. Voice input stays an unsent draft until explicitly submitted.

## V11 Inspect activity, approvals, upcoming work and identity

[IMR-15](https://linear.app/imraghavojha/issue/bc631fbf-d118-4801-9c52-affedd29e120) · Area: ui. Prerequisites: [IMR-5](https://linear.app/imraghavojha/issue/54e9dd94-32af-41b0-ae86-b77961394faa), [IMR-7](https://linear.app/imraghavojha/issue/24bb5e81-16e1-4e90-9126-46d9eff5791e), [IMR-14](https://linear.app/imraghavojha/issue/2ea97df0-575d-4df9-9af5-9bff585661e9).

Match all four agent-panel tabs and avatar/name/status placement. Activity shows actual outcomes and links to related work. Approvals show exact action/account/destination and support deny and revocation. Upcoming shows truthful next-run times. Identity and memory can be edited and forgotten. Changes appear on both devices.

## V12 Track goals and run only requested reminders and schedules

[IMR-16](https://linear.app/imraghavojha/issue/bb51dbc5-387d-4211-acda-810fd0b31a3f) · Area: automation. Prerequisites: [IMR-7](https://linear.app/imraghavojha/issue/24bb5e81-16e1-4e90-9126-46d9eff5791e).

Create, edit, pause, resume, complete and reopen goals and reminders. Scheduled work runs only under explicit user instructions, with visible cause and next time. True month-end dates, timezones and daylight saving are correct. Restart, missed runs and repeated attempts do not duplicate real-world actions. No unsolicited heartbeat or suggestions.

## V13 Manage multiple Google calendars and Gmail accounts

[IMR-17](https://linear.app/imraghavojha/issue/8163be7b-9e46-4457-bdd6-c99fba17944a) · Area: integrations. Prerequisites: [IMR-7](https://linear.app/imraghavojha/issue/24bb5e81-16e1-4e90-9126-46d9eff5791e), [IMR-9](https://linear.app/imraghavojha/issue/2175c734-16a1-493d-b0f6-e94b420d686d).

Connect multiple accounts, view agendas and conflicts, create or change events, search/read mail, work with attachments and prepare drafts. Always identify the target account/calendar or sender. Sending and other significant changes follow the user's permissions. Reconnect and revoked-access states are clear; syncing does not duplicate events.

## V14 Track Canvas courses and coursework

[IMR-18](https://linear.app/imraghavojha/issue/344ed2d0-8295-4eda-a69f-7fbfa2adeb88) · Area: integrations. Prerequisites: [IMR-7](https://linear.app/imraghavojha/issue/24bb5e81-16e1-4e90-9126-46d9eff5791e), [IMR-9](https://linear.app/imraghavojha/issue/2175c734-16a1-493d-b0f6-e94b420d686d).

Connect the user's institution using securely entered credentials or token. Show the courses, assignments, submission status, announcements, grades and materials the account can actually access. Explain missing permissions and expired access. Track coursework only when requested, and make updates available on Mac and Android.

## V15 Reconcile SubItUp shifts and access permitted Outlook mail

[IMR-19](https://linear.app/imraghavojha/issue/a1b9bce6-bd1d-46e3-8427-bc058ac5edc4) · Area: integrations. Prerequisites: [IMR-8](https://linear.app/imraghavojha/issue/553b84e6-e92d-4d90-979f-7f557f78717e), [IMR-9](https://linear.app/imraghavojha/issue/2175c734-16a1-493d-b0f6-e94b420d686d), [IMR-16](https://linear.app/imraghavojha/issue/bb51dbc5-387d-4211-acda-810fd0b31a3f), [IMR-17](https://linear.app/imraghavojha/issue/8163be7b-9e46-4457-bdd6-c99fba17944a).

Use the correct employee sign-in route and reuse existing valid sessions. On the requested last day of the month, compare the entire next month's posted shifts with the selected calendar, show discrepancies and make only authorized corrections. Access Outlook through permitted account access. Pause and notify for reauthentication; do not repeatedly force logouts or guess MFA actions.

## V16 Read an AI and coding feed that learns from swipes

[IMR-20](https://linear.app/imraghavojha/issue/9bbe40e8-d5b2-427a-b486-b30b738c04b4) · Area: feed. Prerequisites: [IMR-5](https://linear.app/imraghavojha/issue/54e9dd94-32af-41b0-ae86-b77961394faa), [IMR-7](https://linear.app/imraghavojha/issue/24bb5e81-16e1-4e90-9126-46d9eff5791e), [IMR-14](https://linear.app/imraghavojha/issue/2ea97df0-575d-4df9-9af5-9bff585661e9).

Show Muse-style editorial cards for explicitly selected AI/coding topics from Hacker News. Include grounded summaries, source and discussion links, dates and why an item was recommended. Swipe left for less like it, right for more and save; provide buttons, keyboard controls and undo. Avoid duplicates, support preference reset, and refresh only when requested or scheduled.

## V17 Use complete settings, library and on-demand ideas

[IMR-21](https://linear.app/imraghavojha/issue/b3013a16-0b72-46ba-9d38-3adf26e06792) · Area: ui. Prerequisites: [IMR-5](https://linear.app/imraghavojha/issue/54e9dd94-32af-41b0-ae86-b77961394faa), [IMR-9](https://linear.app/imraghavojha/issue/2175c734-16a1-493d-b0f6-e94b420d686d), [IMR-10](https://linear.app/imraghavojha/issue/bb2e04b0-4d29-4eb6-b3da-edb838ca8ec2), [IMR-14](https://linear.app/imraghavojha/issue/2ea97df0-575d-4df9-9af5-9bff585661e9).

Preserve Muse's settings groups and library categories, search, sort and previews. Appearance, shortcuts, dictation, devices, permissions, provider choices and data export work and show truthful states. Shared preferences appear on both devices. Ideas are generated only when requested. Unavailable integrations are clearly distinguished from working ones.

## V18 Use the complete Muse-style experience on Android

[IMR-22](https://linear.app/imraghavojha/issue/32ea4850-9a32-42e3-a048-681bf928d988) · Area: android. Prerequisites: [IMR-5](https://linear.app/imraghavojha/issue/54e9dd94-32af-41b0-ae86-b77961394faa), [IMR-7](https://linear.app/imraghavojha/issue/24bb5e81-16e1-4e90-9126-46d9eff5791e), [IMR-14](https://linear.app/imraghavojha/issue/2ea97df0-575d-4df9-9af5-9bff585661e9), [IMR-15](https://linear.app/imraghavojha/issue/bc631fbf-d118-4801-9c52-affedd29e120).

Android includes main/side chats, drawers, all four agent tabs, feed gestures, goals, library and settings, matching the mobile Muse reference. Changes made on Mac appear on Android and vice versa. Handle reconnect/offline state, back navigation, keyboard, accessibility and reduced motion without losing work.

## V19 Invoke Vesper as Android assistant and control alarms

[IMR-23](https://linear.app/imraghavojha/issue/c1196f3b-a81f-4f3a-8506-5c69ff0baaf3) · Area: android. Prerequisites: [IMR-22](https://linear.app/imraghavojha/issue/32ea4850-9a32-42e3-a048-681bf928d988).

On supported devices, the user can choose Vesper as the default assistant and invoke it through the available system gesture or button. Create/manage supported alarms and timers and adjust permitted clock settings. Report confirmed outcomes, denied permission and unsupported behavior accurately. Validate the user's Nothing Phone experience, not only a simulated device.

## V20 Use Google Messages and opt-in phone capabilities

[IMR-24](https://linear.app/imraghavojha/issue/3bc5535c-ddbe-4e68-a2d4-56ad521e8c93) · Area: android. Prerequisites: [IMR-8](https://linear.app/imraghavojha/issue/553b84e6-e92d-4d90-979f-7f557f78717e), [IMR-9](https://linear.app/imraghavojha/issue/2175c734-16a1-493d-b0f6-e94b420d686d), [IMR-22](https://linear.app/imraghavojha/issue/32ea4850-9a32-42e3-a048-681bf928d988).

Pair supported Google Messages access, show connection/expiry state and require the appropriate permission before sending. Make phone notification access and actions separately opt-in and revocable. Explain phone connectivity and device limitations. Distinguish supported functionality from experimental automation; do not promise universal control.

## V21 Deliver reliable, synced behavior and verified Muse parity

[IMR-25](https://linear.app/imraghavojha/issue/10a6d525-2666-43dc-bb57-bc653adb5ca3) · Area: release. Prerequisites: [IMR-9](https://linear.app/imraghavojha/issue/2175c734-16a1-493d-b0f6-e94b420d686d), [IMR-11](https://linear.app/imraghavojha/issue/f84340ba-d4a9-41b0-9608-bbd0384892e8), [IMR-12](https://linear.app/imraghavojha/issue/68b2b780-4a4c-4013-b4c3-22c827e921b7), [IMR-13](https://linear.app/imraghavojha/issue/5a84dcce-b149-4dbd-9ea9-728a397121e1), [IMR-15](https://linear.app/imraghavojha/issue/bc631fbf-d118-4801-9c52-affedd29e120), [IMR-16](https://linear.app/imraghavojha/issue/bb51dbc5-387d-4211-acda-810fd0b31a3f), [IMR-17](https://linear.app/imraghavojha/issue/8163be7b-9e46-4457-bdd6-c99fba17944a), [IMR-18](https://linear.app/imraghavojha/issue/344ed2d0-8295-4eda-a69f-7fbfa2adeb88), [IMR-19](https://linear.app/imraghavojha/issue/a1b9bce6-bd1d-46e3-8427-bc058ac5edc4), [IMR-20](https://linear.app/imraghavojha/issue/9bbe40e8-d5b2-427a-b486-b30b738c04b4), [IMR-21](https://linear.app/imraghavojha/issue/b3013a16-0b72-46ba-9d38-3adf26e06792), [IMR-23](https://linear.app/imraghavojha/issue/c1196f3b-a81f-4f3a-8506-5c69ff0baaf3), [IMR-24](https://linear.app/imraghavojha/issue/3bc5535c-ddbe-4e68-a2d4-56ad521e8c93).

The complete product works across the selected agents and both devices. Demonstrate a shared saved-login journey, a month-end calendar reconciliation, interruption/restart recovery, offline/reconnect behavior and correct approvals. No duplicate external actions or secret exposure in user-visible activity. Every required screen and interaction meets the reference or has an explicit remaining gap. Public installers and updates preserve user data; failed upgrades and backups have a usable recovery path. Browser/provider failure does not take down the workspace, and supported client/provider versions continue working across updates.

## V22 Track development from Linear issue to reviewed GitHub change

[IMR-26](https://linear.app/imraghavojha/issue/15068606-4e2b-47b2-8a1f-0216aecce4d1) · Area: workflow. Prerequisites: none.

Vesper work is organized in Linear and linked to the corresponding GitHub PR. Checks and reviewer findings are visible; genuine findings are resolved before completion. A future agent can identify the next available task and its acceptance criteria. Review services stay within authorized free usage and disclose any expiration or unavailable tier.

## V23 Offer the broader Muse integration catalog and wallet features

[IMR-27](https://linear.app/imraghavojha/issue/ad6ffaa2-4071-4ad0-ad42-89ec2a32eb5f) · Area: integrations. Prerequisites: [IMR-7](https://linear.app/imraghavojha/issue/24bb5e81-16e1-4e90-9126-46d9eff5791e), [IMR-9](https://linear.app/imraghavojha/issue/2175c734-16a1-493d-b0f6-e94b420d686d), [IMR-21](https://linear.app/imraghavojha/issue/b3013a16-0b72-46ba-9d38-3adf26e06792).

Keep the full observed integration catalog in scope. Each entry accurately shows whether it can connect, is connected, needs attention or is unavailable. Connected services support permissions, reconnect and disconnect. Wallet actions require an actual supported payment service and explicit transaction approval. Never present a planned service as already functional.

## V24 Give Vesper an original cute avatar with expressive motion

[IMR-28](https://linear.app/imraghavojha/issue/f71b6da1-f977-47bd-a6cd-1dc459f194e1) · Area: ui. Prerequisites: [IMR-5](https://linear.app/imraghavojha/issue/54e9dd94-32af-41b0-ae86-b77961394faa).

Create an original mascot with Muse-like warmth, scale and placement, without copying Muse's asset. Support idle, listening, working and error states, editable name and appearance, reduced-motion stills and consistent rendering on Mac/Android. Motion should remain smooth and stop when not visible.
