import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startBoardServer } from "../adapters.ts";
import type { BoardServer } from "../index.ts";

let board: BoardServer;
let webRoot: string;

beforeEach(async () => {
  webRoot = await mkdtemp(join(tmpdir(), "tkitchen-board-"));
  await writeFile(join(webRoot, "index.html"), "<h1>board page</h1>\n");
  await mkdir(join(webRoot, "assets"));
  await writeFile(join(webRoot, "assets", "app.js"), "console.log('board');\n");
  board = await startBoardServer({ port: 0, host: "127.0.0.1", webRoot });
});

afterEach(async () => {
  await board.close();
  await rm(webRoot, { recursive: true, force: true });
});

describe("board server", () => {
  it("answers health with ok true", async () => {
    const res = await fetch(board.url + "/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("serves the page at the root", async () => {
    const res = await fetch(board.url + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("board page");
  });

  it("serves built assets with their content type", async () => {
    const res = await fetch(board.url + "/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toContain("board");
  });

  it("answers an unknown client route with the page", async () => {
    const res = await fetch(board.url + "/cards/some-id");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("board page");
  });

  it("refuses a missing asset and a path outside the web root", async () => {
    const missing = await fetch(board.url + "/assets/gone.js");
    expect(missing.status).toBe(404);
    const escaped = await fetch(board.url + "/..%2Fsecret.txt");
    expect(escaped.status).toBe(404);
  });

  it("refuses non-GET requests", async () => {
    const res = await fetch(board.url + "/v1/health", { method: "POST" });
    expect(res.status).toBe(405);
  });
});
