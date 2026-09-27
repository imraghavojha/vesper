# Bring your own agent

The product goal is an open Muse equivalent that can use the person's preferred AI agent, provider and eligible subscription. A provider picker is part of the composer and schedule editor. It shows harness, account, model, connection, usage/reset state, and supported tools. An API endpoint is one provider type, not the only integration model.

## Launch provider targets

| Harness | Integration | Authentication | Evidence and gate |
| --- | --- | --- | --- |
| Codex | App Server for persistent interactive turns; exec for bounded jobs | User-managed supported Codex login or API configuration | Official App Server/noninteractive docs and T3 adapter. Verify account eligibility locally without copying tokens. |
| Claude | Agent SDK around installed Claude binary, with streamed sessions and approval callbacks | API-backed supported path; subscription route requires current eligibility/approval review | T3 uses `@anthropic-ai/claude-agent-sdk` and `query()`. SDK docs restrict third-party subscription login absent approval. |
| OpenCode | Supported HTTP server/events and native sessions | User-configured OpenCode providers | Discover model list; preserve native provider permissions and usage errors. |
| Antigravity | Official ACP agent | Its own supported Google login or supported API mode | T3 integration and ACP registry verified; installed access not tested. |
| Custom API/local model | Explicit endpoint adapter with Vesper-owned tool loop | User-supplied API credential or local endpoint | Must declare structured tool, vision, streaming and context capabilities. A chatbot subscription alone is not an API credential. |

Extensibility should permit additional adapters, including T3's other harness types, without coupling chat or browser code to a vendor. Do not promise every subscription can be reused if the vendor does not expose an authorized integration.

## Claude findings

The statement that Claude cannot be called through commands is incorrect for the current CLI. Its [programmatic guide](https://code.claude.com/docs/en/headless) documents `claude -p`, JSON and stream-JSON output, resuming, and interruption. `--bare` avoids automatic context discovery but currently skips subscription OAuth/keychain login, so it is not a free context-reduction switch for a subscription adapter.

T3's pinned [ClaudeAdapter](https://github.com/pingdotgg/t3code/blob/ab099178a7b7f9728843e90fc95ed90bb61d710d/apps/server/src/provider/Layers/ClaudeAdapter.ts) imports the SDK and creates query sessions. Its [Claude guide](https://github.com/pingdotgg/t3code/blob/ab099178a7b7f9728843e90fc95ed90bb61d710d/docs/user/providers-claude.md) explains existing login/configuration and separate config directories. This is direct technical evidence, not proof of Vesper's permission to offer the same commercial authentication flow.

The [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) says third-party products need prior approval to offer claude.ai login/rate limits. Keep the technical adapter and eligibility gate distinct. Do not extract OAuth tokens, impersonate another client, or silently change to paid API billing. The local `claude` binary was found; no subscription model call was made.

## Switching and continuity

Vesper owns canonical messages, artifacts, goals, approvals and run audit. A provider owns its native session ID and private internal state. Switching models within a compatible session can use the harness's supported operation. Switching harnesses creates a new provider session with a compact handoff containing user-visible conversation, selected memory, artifact references, open task status and relevant tool results.

Never invent or transfer hidden reasoning. Mark the switch in the timeline. Do not carry pending tool approvals to a different provider run. Wait or cancel active execution before switching. Retain the old native session so the user can resume it later. A schedule pins its selected provider/account/model; fallback to another provider or paid API requires an explicit user policy.

Each adapter must pass a common contract suite for streaming order, resume, tool request, approval/deny, cancellation, timeout, auth expiration, unavailable model, usage-limit handling and cost reporting. Unsupported operations remain visible. A provider switch must preserve the same browser/connector permission boundary.
