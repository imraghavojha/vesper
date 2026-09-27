export type QuickChatStatus = {
  requested: string;
  active: string | null;
  error: string | null;
  visible: boolean;
};
export type SpeechStatus = {
  available: boolean;
  locale: string;
  assets: "ready" | "missing" | "downloading" | "unsupported";
  microphone: "not-determined" | "granted" | "denied" | "restricted";
};
export type SpeechEvent = {
  id: string;
  type: "status" | "started" | "transcript" | "stopped" | "error";
  sessionId?: string;
  status?: SpeechStatus;
  text?: string;
  revision?: number;
  final?: boolean;
  reason?: string;
  code?: string;
  message?: string;
};
export type SpeechCommand = {
  id: string;
  command: "status" | "prepare" | "start" | "stop" | "cancel";
  sessionId?: string;
  locale?: string;
};
