export type Connection = { url: string; token: string };
export function normalizeHost(value: string): string {
  const url = new URL(value.trim());
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "Use the host address without a path, credentials, or query.",
    );
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "10.0.2.2"].includes(
    url.hostname,
  );
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(
      "Use HTTPS for a remote host. HTTP is allowed only on this device or the Android emulator.",
    );
  }
  return url.origin;
}
