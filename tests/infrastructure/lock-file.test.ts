import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";
import { FileLock } from "../../src/infrastructure/lock-file.ts";

function makeHome(): string { return mkdtempSync(join(tmpdir(), "tk-lock-")); }

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise<void>((resolve) => { child.on("exit", () => { resolve(); }); });
  if (child.pid === undefined) throw new Error("child had no pid");
  return child.pid;
}

interface Contender { child: ChildProcess; result: Promise<{ pid: number; result: string }>; exited: Promise<void>; }

function startContender(home: string): Contender {
  const script = pathJoin(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "lock-contender.mjs");
  const child = spawn(process.execPath, [script, home], { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  const result = new Promise<{ pid: number; result: string }>((resolve, reject) => {
    child.stdout?.on("data", (d: Buffer) => {
      buffer += d.toString();
      const line = buffer.split("\n").find((l) => l.trim() !== "");
      if (line !== undefined) {
        try { resolve(JSON.parse(line) as { pid: number; result: string }); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
      }
    });
    child.on("exit", (code) => { if (code !== null && code !== 0) reject(new Error("contender exited " + code)); });
  });
  const exited = new Promise<void>((resolve) => { child.on("exit", () => { resolve(); }); });
  return { child, result, exited };
}

describe("FileLock", () => {
  it("acquires, reports its pid, and releases", async () => {
    const home = makeHome();
    const lock = new FileLock(home);
    expect(await lock.acquire()).toBe("acquired");
    expect(existsSync(lock.path)).toBe(true);
    const content = JSON.parse(readFileSync(lock.path, "utf8")) as { pid: number; startedAt: string };
    expect(content.pid).toBe(process.pid);
    expect(typeof content.startedAt).toBe("string");
    expect(await lock.holderPid()).toBe(process.pid);
    await lock.release();
    expect(existsSync(lock.path)).toBe(false);
  });

  it("refuses while a live pid holds the lock", async () => {
    const home = makeHome();
    const lock = new FileLock(home);
    writeFileSync(lock.path, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    expect(await lock.acquire()).toBe("held");
    expect(await lock.holderPid()).toBe(process.pid);
  });

  it("takes over a lock whose pid is dead", async () => {
    const home = makeHome();
    const lock = new FileLock(home);
    writeFileSync(lock.path, JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
    expect(await lock.acquire()).toBe("acquired");
    const content = JSON.parse(readFileSync(lock.path, "utf8")) as { pid: number };
    expect(content.pid).toBe(process.pid);
    await lock.release();
  });

  it("treats a fresh unparseable lock as held and an old one as stale", async () => {
    const home = makeHome();
    const lock = new FileLock(home);
    writeFileSync(lock.path, "not json");
    expect(await lock.acquire()).toBe("held");
    const longAgo = new Date(Date.now() - 60000);
    utimesSync(lock.path, longAgo, longAgo);
    expect(await lock.acquire()).toBe("acquired");
    await lock.release();
  });

  it("concurrent stale takeover has exactly one winner across processes", async () => {
    for (let round = 0; round < 10; round++) {
      const home = makeHome();
      const stalePath = join(home, "kitchen.lock");
      writeFileSync(stalePath, JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
      const contenders = Array.from({ length: 6 }, () => startContender(home));
      try {
        for (const c of contenders) c.child.stdin?.write("go\n");
        const results = await Promise.all(contenders.map((c) => c.result));
        const winners = results.filter((r) => r.result === "acquired");
        expect(results.map((r) => r.result), "round " + round).not.toContain("error");
        expect(winners, "round " + round + ": " + JSON.stringify(results)).toHaveLength(1);
        const winnerPid = winners[0]?.pid;
        const content = JSON.parse(readFileSync(stalePath, "utf8")) as { pid: number };
        expect(content.pid).toBe(winnerPid);
        for (const c of contenders) {
          if (c.child.pid === winnerPid) c.child.stdin?.write("release\n");
          else c.child.kill();
        }
        await Promise.all(contenders.map((c) => c.exited));
        expect(existsSync(stalePath)).toBe(false);
      } finally {
        for (const c of contenders) c.child.kill();
      }
    }
  }, 120000);

  it("release leaves a lock now held by another pid", async () => {
    const home = makeHome();
    const lock = new FileLock(home);
    expect(await lock.acquire()).toBe("acquired");
    writeFileSync(lock.path, JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
    await lock.release();
    expect(existsSync(lock.path)).toBe(true);
  });
});
