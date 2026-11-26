import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cli, git } from "../../testing/adapters.ts";

const FAKE_GH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "fake-gh");

interface Fixture {
  home: string;
  work: string;
  lockPath: string;
}
interface Running {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

async function makeFixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "tk-serve-"));
  const home = join(root, "home");
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  mkdirSync(home, { recursive: true });
  await git(root, "init", "--bare", origin);
  await git(root, "clone", origin, work);
  await git(work, "config", "user.email", "t@t.t");
  await git(work, "config", "user.name", "T");
  await git(work, "checkout", "-b", "main");
  writeFileSync(join(work, "main.txt"), "main\n");
  await git(work, "add", ".");
  await git(work, "commit", "-m", "main");
  await git(work, "push", "-u", "origin", "main");
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ repos: [{ name: "x", path: work, bases: {} }], roundMinutes: 60 }),
  );
  return { home, work, lockPath: join(home, "kitchen.lock") };
}

function startServe(f: Fixture): Running {
  const env: Record<string, string | undefined> = {
    ...process.env,
    TKITCHEN_HOME: f.home,
    PATH: FAKE_GH_DIR + delimiter + (process.env["PATH"] ?? ""),
  };
  env["FAKE_GH_PRS_FILE"] = join(FAKE_GH_DIR, "prs.json");
  const child = spawn(process.execPath, ["modules/cli/lib/adapters/main.ts", "serve"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout?.on("data", (d: Buffer) => {
    out += d.toString();
  });
  child.stderr?.on("data", (d: Buffer) => {
    out += d.toString();
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => {
      resolve(code);
    });
  });
  return { child, output: () => out, exited };
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 30000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for " + label);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
}

function lockPid(f: Fixture): number {
  const parsed = JSON.parse(readFileSync(f.lockPath, "utf8")) as { pid: number };
  return parsed.pid;
}

const NEVER_ASSIGNED_PID = 999999999;

async function deadPid(): Promise<number> {
  let pid = NEVER_ASSIGNED_PID;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return pid;
    }
    pid -= 1;
  }
}

describe("serve lock", () => {
  it("second serve refuses while the first runs", async () => {
    const f = await makeFixture();
    const first = startServe(f);
    try {
      await waitFor(() => existsSync(f.lockPath), "kitchen.lock");
      expect(first.child.pid).toBeDefined();
      expect(lockPid(f)).toBe(first.child.pid);
      const second = await cli(f.home, "serve");
      expect(second.code).toBe(1);
      expect(second.stdout + second.stderr).toContain("already running (pid " + first.child.pid + ")");
      expect(first.child.exitCode).toBeNull();
    } finally {
      first.child.kill("SIGTERM");
      await first.exited;
    }
  }, 60000);

  it("round refuses while serve runs and --force is not a bypass", async () => {
    const f = await makeFixture();
    const first = startServe(f);
    try {
      await waitFor(() => existsSync(f.lockPath), "kitchen.lock");
      const round = await cli(f.home, "round");
      expect(round.code).toBe(1);
      expect(round.stdout + round.stderr).toContain("already running");
      const forced = await cli(f.home, "round", "--force");
      expect(forced.code).toBe(2);
    } finally {
      first.child.kill("SIGTERM");
      await first.exited;
    }
  }, 60000);

  it("dead pid lock is taken over", async () => {
    const f = await makeFixture();
    writeFileSync(f.lockPath, JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
    const first = startServe(f);
    try {
      await waitFor(() => existsSync(f.lockPath) && lockPid(f) === first.child.pid, "lock takeover");
      expect(lockPid(f)).toBe(first.child.pid);
    } finally {
      first.child.kill("SIGTERM");
      await first.exited;
    }
  }, 60000);

  it("round runs when no serve holds the lock and releases it", async () => {
    const f = await makeFixture();
    const round = await cli(f.home, "round");
    expect(round.code).toBe(0);
    expect(existsSync(f.lockPath)).toBe(false);
  }, 60000);
});
