export type Appearance = "system" | "light" | "dark";
export type Conversation = {
  id: string;
  kind: "main" | "side";
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type Message = {
  id: string;
  sequence: number;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};
export type Settings = { appearance: Appearance; revision: number };
export type Change = {
  cursor: number;
  kind: "conversation" | "message" | "settings";
  entityId: string;
  revision: number;
};
export type MutationResult = { id: string; cursor: number; revision: number };
export type Draft = {
  text: string;
  pending: { requestId: string; text: string } | null;
};

export async function messageRequestHash(
  conversationId: string,
  text: string,
): Promise<string> {
  const input = JSON.stringify(["sendMessage", { conversationId, text }]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createConversationRequestHash(
  title: string,
): Promise<string> {
  const input = JSON.stringify(["createConversation", { title }]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
