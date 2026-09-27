export type ProviderSelection = {
  provider: "claude";
  accountId: string;
  modelId: string;
};
export type ProviderAccount = { id: string; label: string; plan?: string };
export type ProviderModel = { id: string; label: string };
export type ProviderAvailability = {
  provider: "claude";
  status: "available" | "unavailable" | "auth-required" | "blocked";
  account?: ProviderAccount;
  models: ProviderModel[];
  reason?: string;
  capabilities: { chat: boolean; tools: false; nativeResume: false };
};
export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  limit?: {
    status: "allowed" | "allowed_warning" | "rejected";
    utilization?: number;
    resetsAt?: number;
  };
};
export type ProviderErrorCode =
  | "unavailable"
  | "auth-required"
  | "account-changed"
  | "model-unavailable"
  | "unsafe-configuration"
  | "quota-exceeded"
  | "network"
  | "timeout"
  | "internal";
export type ProviderAttestation = {
  selection: ProviderSelection;
  account: ProviderAccount;
  tools: [];
  toolsProof: "sdk-option-and-spawn-flags" | "sdk-turn-init";
  mcpServers: [];
};
export type ProviderTerminal = {
  kind: "terminal";
  runId: string;
  selection: ProviderSelection;
  status: "completed" | "cancelled" | "failed";
  text: string;
  nativeSessionId?: string;
  usage?: ProviderUsage;
  error?: { code: ProviderErrorCode; message: string };
  receipt:
    "sdk-result" | "sdk-interrupt" | "process-exit" | "not-started" | "unknown";
};
export type ProviderEvent =
  | {
      kind: "initialized";
      runId: string;
      attestation: ProviderAttestation;
      nativeSessionId?: string;
    }
  | { kind: "text"; runId: string; text: string }
  | { kind: "usage"; runId: string; usage: ProviderUsage }
  | ProviderTerminal;
export type ProviderRunInput = {
  runId: string;
  selection: ProviderSelection;
  prompt: string;
};
export type ProviderRunHandle = {
  ready: Promise<ProviderAttestation>;
  events: AsyncIterable<ProviderEvent>;
  completion: Promise<ProviderTerminal>;
  cancel(): Promise<ProviderTerminal>;
  close(): Promise<void>;
};
export type ChatProvider = {
  discover(): Promise<ProviderAvailability>;
  start(input: ProviderRunInput): ProviderRunHandle;
};
export type ClaudeAdapterOptions = {
  executablePath: string;
  runtimeDirectory: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
};
