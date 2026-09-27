import { createServer } from "node:http";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { appRouter } from "./router.js";
import { openStore } from "./store.js";

const port = Number(process.env.VESPER_PORT ?? 4317);
const address = process.env.VESPER_BIND ?? "127.0.0.1";
const store = openStore(resolve(process.env.VESPER_DATA_DIR ?? ".vesper"));
const allowedOrigins = new Set(
  (
    process.env.VESPER_ALLOWED_ORIGINS ??
    `http://127.0.0.1:${port},http://localhost:${port},http://127.0.0.1:5177,http://localhost:5177`
  )
    .split(",")
    .map((s) => s.trim()),
);
const handler = createHTTPHandler({
  router: appRouter,
  basePath: "/trpc/",
  maxBodySize: 16 * 1024,
  allowBatching: false,
  createContext({ req }) {
    const auth = req.headers.authorization;
    return {
      store,
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
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, address, () =>
  console.info(`Vesper host listening on ${address}:${port}`),
);
function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
