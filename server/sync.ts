import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { Store } from "./store.js";

export function attachSync(
  server: Server,
  store: Store,
  allowedOrigins: Set<string>,
) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", (request, socket, head) => {
    if (
      request.url !== "/sync" ||
      (request.headers.origin && !allowedOrigins.has(request.headers.origin))
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) =>
      sockets.emit("connection", ws),
    );
  });
  sockets.on("connection", (socket: WebSocket) => {
    let deviceId: string | null = null;
    let token: string | null = null;
    let unsubscribeChanges = () => {};
    let unsubscribeRevocations = () => {};
    const deadline = setTimeout(
      () => socket.close(1008, "Authentication required"),
      5000,
    );
    function notify() {
      if (!token || !store.authenticate(token)) {
        socket.close(4001, "Access revoked");
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 65536) {
        socket.close(1013, "Reconnect to refresh");
        return;
      }
      socket.send(
        JSON.stringify({ type: "changed", cursor: store.changeCursor() }),
      );
    }
    socket.on("error", () => {
      /* Client socket failures contain no application logs. */
    });
    socket.on("message", (data) => {
      if (deviceId) {
        socket.close(1008, "Authentication already supplied");
        return;
      }
      try {
        const value: unknown = JSON.parse(data.toString());
        if (
          !value ||
          typeof value !== "object" ||
          !("type" in value) ||
          value.type !== "authenticate" ||
          !("token" in value) ||
          typeof value.token !== "string" ||
          value.token.length !== 43
        )
          throw new Error();
        const device = store.authenticate(value.token);
        if (!device) {
          socket.close(4001, "Invalid or revoked device");
          return;
        }
        clearTimeout(deadline);
        deviceId = device.id;
        token = value.token;
        unsubscribeChanges = store.subscribeChanges(notify);
        unsubscribeRevocations = store.subscribeRevocations((id) => {
          if (id === deviceId) socket.close(4001, "Access revoked");
        });
        notify();
      } catch {
        socket.close(1008, "Authentication failed");
      }
    });
    socket.once("close", () => {
      clearTimeout(deadline);
      unsubscribeChanges();
      unsubscribeRevocations();
      token = null;
    });
  });
  return {
    close() {
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
    },
  };
}
