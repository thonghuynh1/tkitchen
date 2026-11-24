import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { FileLock } from "../../src/infrastructure/lock-file.ts";

function makeHome(): string { return mkdtempSync(join(tmpdir(), "tk-lock-")); }

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise<void>((resolve) => { child.on("exit", () => { resolve(); }); });
  if (child.pid === undefined) throw new Error("child had no pid");
  return child.pid;
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

  it("release leaves a lock now held by another pid", async () => {
    const home = makeHome();
    const lock = new FileLock(home);
    expect(await lock.acquire()).toBe("acquired");
    writeFileSync(lock.path, JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
    await lock.release();
    expect(existsSync(lock.path)).toBe(true);
  });
});
