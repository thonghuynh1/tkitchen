import type { IncomingMessage, ServerResponse } from "node:http";
import type { LiveHandle, LiveHub } from "../../../live/index.ts";
import { viewerFromRequest } from "./auth-routes.ts";
import type { AuthContext } from "./auth-routes.ts";

const STREAM_PATH = "/v1/stream";
const KEEPALIVE_MS = 25_000;
const STATUS_OK = 200;
const STATUS_UNAUTHORIZED = 401;
const STATUS_METHOD_NOT_ALLOWED = 405;
const STATUS_UNAVAILABLE = 503;

export function isStreamPath(pathname: string): boolean {
  return pathname === STREAM_PATH;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function routeStream(
  auth: AuthContext | null,
  live: LiveHub | null,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (auth === null || live === null) {
    sendJson(res, STATUS_UNAVAILABLE, { ok: false, error: "live stream is not configured" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, STATUS_METHOD_NOT_ALLOWED, { ok: false, error: "method not allowed" });
    return;
  }
  const viewer = viewerFromRequest(auth, req);
  if (viewer === null) {
    sendJson(res, STATUS_UNAUTHORIZED, { ok: false, error: "unauthorized" });
    return;
  }
  res.writeHead(STATUS_OK, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");

  let closed = false;
  let unregister: () => void = () => undefined;
  const keepalive = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(": keepalive\n\n");
  }, KEEPALIVE_MS);
  keepalive.unref();

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    unregister();
    if (!res.writableEnded) res.end();
  };

  const handle: LiveHandle = {
    write: (chunk: string): void => {
      if (!closed && !res.writableEnded) res.write(chunk);
    },
    end: cleanup,
  };

  unregister = live.register(viewer.user.id, handle);
  req.on("close", cleanup);
  res.on("close", cleanup);
}
