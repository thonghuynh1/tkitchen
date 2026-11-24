import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork, spawn } from "node:child_process";
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

interface ScheduleWorker { child: ChildProcess; next: () => Promise<{ type: string; tag?: string; pid: number; result?: string }>; exited: Promise<void>; }

function startScheduleWorker(home: string, mode: string): ScheduleWorker {
  const script = pathJoin(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "lock-schedule-worker.mjs");
  const child = fork(script, [home, mode], { execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const queue: { type: string; tag?: string; pid: number; result?: string }[] = [];
  const waiters: ((m: { type: string; tag?: string; pid: number; result?: string }) => void)[] = [];
  child.on("message", (m: { type: string; tag?: string; pid: number; result?: string }) => {
    const waiter = waiters.shift();
    if (waiter !== undefined) waiter(m);
    else queue.push(m);
  });
  const exited = new Promise<void>((resolve) => { child.on("exit", () => { resolve(); }); });
  return { child, exited, next: () => {
    const queued = queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => { waiters.push(resolve); });
  } };
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

  it("recovers a takeover claim whose owner pid is dead", async () => {
    const home = makeHome();
    const lock = new FileLock(home);
    writeFileSync(lock.path, JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
    writeFileSync(join(home, "kitchen.lock.takeover"), JSON.stringify({ pid: await deadPid(), key: "stale" }));
    expect(await lock.acquire()).toBe("acquired");
    await lock.release();
    expect(existsSync(join(home, "kitchen.lock.takeover"))).toBe(false);
  });

  it("recovers an ownerless takeover claim left by a crashed takeover", async () => {
    const home = makeHome();
    const lock = new FileLock(home);
    writeFileSync(lock.path, JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
    const takeoverPath = join(home, "kitchen.lock.takeover");
    writeFileSync(takeoverPath, "");
    const longAgo = new Date(Date.now() - 60000);
    utimesSync(takeoverPath, longAgo, longAgo);
    expect(await lock.acquire()).toBe("acquired");
    await lock.release();
  });

  it("a successor process acquires when a takeover claim owner died", async () => {
    const home = makeHome();
    const stalePath = join(home, "kitchen.lock");
    writeFileSync(stalePath, JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
    const takeoverPath = join(home, "kitchen.lock.takeover");
    writeFileSync(takeoverPath, JSON.stringify({ pid: await deadPid(), key: "stale" }));
    const contender = startContender(home);
    try {
      contender.child.stdin?.write("go\n");
      const result = await contender.result;
      expect(result.result).toBe("acquired");
      contender.child.stdin?.write("release\n");
      await contender.exited;
      expect(existsSync(stalePath)).toBe(false);
    } finally {
      contender.child.kill();
    }
  }, 60000);

  it("does not steal a takeover claim held by a live pid", async () => {
    const home = makeHome();
    const lock = new FileLock(home);
    writeFileSync(lock.path, JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
    const takeoverPath = join(home, "kitchen.lock.takeover");
    const claim = JSON.stringify({ pid: process.pid, key: "stale" });
    writeFileSync(takeoverPath, claim);
    expect(await lock.acquire()).toBe("held");
    expect(readFileSync(takeoverPath, "utf8")).toBe(claim);
    rmSync(takeoverPath, { force: true });
  }, 60000);

  it("forced delayed stale-read schedule has exactly one winner", async () => {
    const home = makeHome();
    writeFileSync(join(home, "kitchen.lock"), JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
    const delayed = startScheduleWorker(home, "delayed-stale-read");
    const normal = startScheduleWorker(home, "normal");
    try {
      const checkpoint = await delayed.next();
      expect(checkpoint.tag).toBe("delayed-stale-read");
      const normalResult = await normal.next();
      expect(normalResult.result).toBe("acquired");
      delayed.child.send("resume");
      const delayedResult = await delayed.next();
      expect(delayedResult.result).toBe("held");
      const content = JSON.parse(readFileSync(join(home, "kitchen.lock"), "utf8")) as { pid: number };
      expect(content.pid).toBe(normal.child.pid);
      normal.child.send("stop");
      delayed.child.send("stop");
      await Promise.all([delayed.exited, normal.exited]);
    } finally {
      delayed.child.kill();
      normal.child.kill();
    }
  }, 60000);

  it("forced delayed takeover-recovery schedule has exactly one winner", async () => {
    const home = makeHome();
    writeFileSync(join(home, "kitchen.lock"), JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
    writeFileSync(join(home, "kitchen.lock.takeover"), JSON.stringify({ pid: await deadPid(), key: "stale" }));
    const delayed = startScheduleWorker(home, "delayed-takeover-read");
    const normal = startScheduleWorker(home, "normal");
    try {
      const checkpoint = await delayed.next();
      expect(checkpoint.tag).toBe("delayed-takeover-read");
      const normalResult = await normal.next();
      expect(normalResult.result).toBe("acquired");
      delayed.child.send("resume");
      const delayedResult = await delayed.next();
      expect(delayedResult.result).toBe("held");
      const content = JSON.parse(readFileSync(join(home, "kitchen.lock"), "utf8")) as { pid: number };
      expect(content.pid).toBe(normal.child.pid);
      normal.child.send("stop");
      delayed.child.send("stop");
      await Promise.all([delayed.exited, normal.exited]);
    } finally {
      delayed.child.kill();
      normal.child.kill();
    }
  }, 60000);

  it("forced missing-claim recovery schedule has exactly one winner", async () => {
    const home = makeHome();
    writeFileSync(join(home, "kitchen.lock"), JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
    const takeoverPath = join(home, "kitchen.lock.takeover");
    writeFileSync(takeoverPath, JSON.stringify({ pid: await deadPid(), key: "planted" }));
    const recoverer = startScheduleWorker(home, "recoverer");
    let publisher: ReturnType<typeof startScheduleWorker> | undefined;
    try {
      const first = await recoverer.next();
      expect(first.tag).toBe("r-claim-exists");
      rmSync(takeoverPath, { force: true });
      recoverer.child.send("resume");
      const paused = await recoverer.next();
      expect(paused.tag).toBe("r-before-unlink-lock");
      publisher = startScheduleWorker(home, "publisher");
      const publisherResult = await publisher.next();
      expect(publisherResult.result).toBe("held");
      recoverer.child.send("resume");
      const recovererResult = await recoverer.next();
      expect(recovererResult.result).toBe("acquired");
      const content = JSON.parse(readFileSync(join(home, "kitchen.lock"), "utf8")) as { pid: number };
      expect(content.pid).toBe(recoverer.child.pid);
      recoverer.child.send("stop");
      publisher.child.send("stop");
      await Promise.all([recoverer.exited, publisher.exited]);
    } finally {
      recoverer.child.kill();
      publisher?.child.kill();
    }
  }, 60000);

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
