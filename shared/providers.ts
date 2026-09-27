import type {
  ProviderSelection,
  ProviderUsage,
} from "../server/providers/contract.js";
export type ProviderBinding = ProviderSelection & { revision: number };
export type RunStatus =
  | "queued"
  | "initializing"
  | "running"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted";
export type ProviderRun = {
  id: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  selection: ProviderSelection;
  status: RunStatus;
  text: string;
  revision: number;
  nativeSessionId: string | null;
  usage: ProviderUsage | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  receipt: string | null;
};
export type AskIntent = {
  selection: ProviderSelection;
  bindingRevision: number;
};
