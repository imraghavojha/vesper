import { createServer } from "node:http";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { appRouter } from "./router.js";
import { openStore } from "./store.js";
import { attachSync } from "./sync.js";
import { createProviderRuntime } from "./provider-runtime.js";
import { createClaudeAdapter } from "./providers/claude.js";
import { homedir } from "node:os";

type ManagedPort = {
  postMessage(value: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
};
const parentPort = (process as typeof process & { parentPort?: ManagedPort })
  .parentPort;
const managed =
  process.env.VESPER_MANAGED_LOCAL === "1" && parentPort !== undefined;
const port = Number(process.env.VESPER_PORT ?? 4317);
const address = managed
  ? "127.0.0.1"
  : (process.env.VESPER_BIND ?? "127.0.0.1");
const store = openStore(
  resolve(process.env.VESPER_DATA_DIR ?? ".vesper"),
  managed ? process.env.VESPER_EXPECTED_WORKSPACE_ID : undefined,
);
const providers = createProviderRuntime(
  store,
  createClaudeAdapter({
    executablePath:
      process.env.VESPER_CLAUDE_PATH ?? resolve(homedir(), ".local/bin/claude"),
    runtimeDirectory: resolve(
      process.env.VESPER_DATA_DIR ?? ".vesper",
      "provider-runtime",
      "claude",
    ),
    maxOutputTokens: 2048,
    timeoutMs: 120000,
  }),
);
const allowedOrigins = new Set(
  (
    process.env.VESPER_ALLOWED_ORIGINS ??
    `http://127.0.0.1:${port},http://localhost:${port},http://127.0.0.1:5177,http://localhost:5177,vesper://app`
  )
    .split(",")
    .map((s) => s.trim()),
);
const handler = createHTTPHandler({
  router: appRouter,
  basePath: "/trpc/",
  maxBodySize: 128 * 1024,
  allowBatching: false,
  createContext({ req }) {
    const auth = req.headers.authorization;
    return {
      store,
      providers,
      device: store.authenticate(
        auth?.startsWith("Bearer ") ? auth.slice(7) : undefined,
      ),
    };
  },
});
const webRoot = resolve(fileURLToPath(new URL("../web/", import.meta.url)));
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    res.writeHead(403).end("Origin not allowed");
    return;
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.writeHead(204).end();
    return;
  }
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    res.writeHead(400).end("Malformed request target");
    return;
  }
  if (url.pathname === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "ok", protocolVersion: 1 }));
    return;
  }
  if (url.pathname.startsWith("/trpc/")) {
    await handler(req, res);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  try {
    const path = resolve(webRoot, "." + decodeURIComponent(url.pathname));
    if (path !== webRoot && !path.startsWith(webRoot + sep)) {
      res.writeHead(403).end();
      return;
    }
    let file = path;
    try {
      if (!(await stat(file)).isFile()) file = resolve(webRoot, "index.html");
    } catch {
      file = resolve(webRoot, "index.html");
    }
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https: wss: ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader(
      "Content-Type",
      types[extname(file)] ?? "application/octet-stream",
    );
    const content = await readFile(file);
    res.end(req.method === "HEAD" ? undefined : content);
  } catch {
    res
      .writeHead(404)
      .end(
        "Web client is not built. Run npm run build, or use npm run dev:web.",
      );
  }
});
const sync = attachSync(server, store, allowedOrigins);
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
let actualPort = port;
server.listen(port, address, () => {
  const bound = server.address();
  if (!bound || typeof bound === "string")
    throw new Error("Host did not bind a TCP port.");
  actualPort = bound.port;
  allowedOrigins.add(`http://127.0.0.1:${actualPort}`);
  allowedOrigins.add(`http://localhost:${actualPort}`);
  console.info(`Vesper host listening on ${address}:${actualPort}`);
  if (managed)
    parentPort.postMessage({
      type: "host-ready",
      port: actualPort,
      workspaceId: store.identity().id,
    });
});
server.on("error", (error: NodeJS.ErrnoException) => {
  if (managed)
    parentPort.postMessage({
      type: "host-error",
      code: error.code ?? "START_FAILED",
      message: "Local workspace could not start.",
    });
  else
    console.error(
      `Vesper host could not start (${error.code ?? "unknown error"}).`,
    );
  store.close();
  if (managed) setImmediate(() => process.exit(1));
  else process.exitCode = 1;
});
if (managed)
  parentPort.on("message", ({ data }) => {
    if (!data || typeof data !== "object" || !("type" in data)) return;
    if (data.type === "shutdown") {
      shutdown();
      return;
    }
    if (
      data.type !== "bootstrap" ||
      !("requestId" in data) ||
      typeof data.requestId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(data.requestId)
    )
      return;
    try {
      const code = store.createPairingCode().code;
      const connection = store.pair({
        code,
        name: "This Mac",
        platform: "mac",
      });
      parentPort.postMessage({
        type: "bootstrap-result",
        requestId: data.requestId,
        connection: {
          url: `http://127.0.0.1:${actualPort}`,
          token: connection.token,
          workspaceId: connection.workspaceId,
        },
      });
    } catch {
      parentPort.postMessage({
        type: "bootstrap-error",
        requestId: data.requestId,
        message: "Local device connection could not be created. Try again.",
      });
    }
  });
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  sync.close();
  server.close(() => {
    void providers.close().finally(() => {
      store.close();
      process.exit(0);
    });
  });
  server.closeIdleConnections();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
