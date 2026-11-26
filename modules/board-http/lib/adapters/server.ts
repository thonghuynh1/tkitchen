import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve, sep } from "node:path";
import { contentTypeFor } from "../content-types.ts";
import type { BoardServer, BoardServerOptions } from "../contract.ts";

const HEALTH_PATH = "/v1/health";
const INDEX_FILE = "index.html";
const STATUS_OK = 200;
const STATUS_NOT_FOUND = 404;
const STATUS_METHOD_NOT_ALLOWED = 405;
const STATUS_INTERNAL = 500;

function sendJson(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

async function fileToServe(webRoot: string, pathname: string): Promise<string | null> {
  const relative = pathname === "/" ? INDEX_FILE : pathname.slice(1);
  const candidate = resolve(webRoot, relative);
  if (candidate !== webRoot && !candidate.startsWith(webRoot + sep)) return null;
  const info = await stat(candidate).catch(() => null);
  if (info?.isFile() === true) return candidate;
  if (!relative.includes(".")) {
    const index = resolve(webRoot, INDEX_FILE);
    const indexInfo = await stat(index).catch(() => null);
    if (indexInfo?.isFile() === true) return index;
  }
  return null;
}

async function respond(webRoot: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, STATUS_METHOD_NOT_ALLOWED, JSON.stringify({ ok: false, error: "method not allowed" }));
    return;
  }
  const url = new URL(req.url ?? "/", "http://board");
  if (url.pathname === HEALTH_PATH) {
    sendJson(res, STATUS_OK, JSON.stringify({ ok: true }));
    return;
  }
  const file = await fileToServe(webRoot, decodeURIComponent(url.pathname));
  if (file === null) {
    sendJson(res, STATUS_NOT_FOUND, JSON.stringify({ ok: false, error: "not found" }));
    return;
  }
  res.writeHead(STATUS_OK, { "content-type": contentTypeFor(file) });
  createReadStream(file).pipe(res);
}

export function startBoardServer(options: BoardServerOptions): Promise<BoardServer> {
  const webRoot = resolve(options.webRoot);
  const server = createServer((req, res) => {
    respond(webRoot, req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(STATUS_INTERNAL, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "request failed" }));
    });
  });
  return new Promise<BoardServer>((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectStart(new Error("board server did not report an address"));
        return;
      }
      resolveStart({
        url: "http://" + options.host + ":" + String(address.port),
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => {
              resolveClose();
            });
          }),
      });
    });
  });
}
