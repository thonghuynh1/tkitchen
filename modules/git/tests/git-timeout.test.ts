import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { git, cli } from "../../../tests/helpers.ts";
import { createGitRunner, GitRepoImpl, GIT_TIMEOUT_MS } from "../adapters.ts";
import { PortError } from "../../platform/index.ts";

const SLOW_TIMEOUT_MS = 200;
const ONE_SECOND_MS = 1000;
const SLEEP_MS = 5000;

function writeSleepScript(root: string): string {
  const script = join(root, "sleep.mjs");
  writeFileSync(script, "setTimeout(() => undefined, " + SLEEP_MS + ");\n");
  return script;
}
function sshCommand(script: string): string {
  return 'node "' + script.replaceAll("\\", "/") + '"';
}

describe("git timeout", () => {
  it("exports the named 20s constant", () => {
    expect(GIT_TIMEOUT_MS).toBe(20_000);
  });

  it("runner with timeoutMs overridden to 200 kills a sleeping transport within 1s", async () => {
    const root = mkdtempSync(join(tmpdir(), "tk-timeout-"));
    const script = writeSleepScript(root);
    const previous = process.env["GIT_SSH_COMMAND"];
    process.env["GIT_SSH_COMMAND"] = sshCommand(script);
    try {
      const runner = createGitRunner({ timeoutMs: SLOW_TIMEOUT_MS });
      const started = Date.now();
      let caught: unknown = null;
      try {
        await runner(["ls-remote", "ssh://git@example.invalid/repo.git"], root);
      } catch (e) {
        caught = e;
      }
      const elapsed = Date.now() - started;
      expect(caught).toBeInstanceOf(PortError);
      expect(caught instanceof PortError ? caught.kind : "").toBe("timeout");
      expect(caught instanceof Error ? caught.message : "").toContain("timeout");
      expect(elapsed).toBeLessThan(ONE_SECOND_MS);

      const repo = new GitRepoImpl(root, { timeoutMs: SLOW_TIMEOUT_MS });
      const started2 = Date.now();
      let caught2: unknown = null;
      try {
        await repo.lsRemoteHeads("ssh://git@example.invalid/repo.git");
      } catch (e) {
        caught2 = e;
      }
      expect(caught2).toBeInstanceOf(PortError);
      expect(caught2 instanceof PortError ? caught2.kind : "").toBe("timeout");
      expect(Date.now() - started2).toBeLessThan(ONE_SECOND_MS);
    } finally {
      if (previous === undefined) delete process.env["GIT_SSH_COMMAND"];
      else process.env["GIT_SSH_COMMAND"] = previous;
    }
  }, 30000);

  it("CLI round on a slow transport exits 1, writes nothing, and records timeout", async () => {
    const root = mkdtempSync(join(tmpdir(), "tk-timeout-cli-"));
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
    writeFileSync(join(home, "config.json"), JSON.stringify({ repos: [{ name: "x", path: work, bases: {} }] }));
    expect((await cli(home, "round", "--repo", "x")).code).toBe(0);
    const dbPath = join(home, "kitchen.db");
    const snapshot = (): string => {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const out: Record<string, unknown> = {};
        for (const table of ["event", "disposition", "branch_state", "repo_heads"])
          out[table] = db.prepare("SELECT * FROM " + table).all();
        return JSON.stringify(out);
      } finally {
        db.close();
      }
    };
    const before = snapshot();
    const script = writeSleepScript(root);
    await git(work, "remote", "set-url", "origin", "ssh://git@example.invalid/repo.git");
    const previousSsh = process.env["GIT_SSH_COMMAND"];
    const previousTimeout = process.env["TKITCHEN_GIT_TIMEOUT_MS"];
    process.env["GIT_SSH_COMMAND"] = sshCommand(script);
    process.env["TKITCHEN_GIT_TIMEOUT_MS"] = String(SLOW_TIMEOUT_MS);
    try {
      const started = Date.now();
      const result = await cli(home, "round", "--repo", "x");
      expect(result.code).toBe(1);
      expect(Date.now() - started).toBeLessThan(10000);
    } finally {
      if (previousSsh === undefined) delete process.env["GIT_SSH_COMMAND"];
      else process.env["GIT_SSH_COMMAND"] = previousSsh;
      if (previousTimeout === undefined) delete process.env["TKITCHEN_GIT_TIMEOUT_MS"];
      else process.env["TKITCHEN_GIT_TIMEOUT_MS"] = previousTimeout;
    }
    expect(snapshot()).toBe(before);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db.prepare("SELECT * FROM round_status").all() as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(String(rows[0]?.["last_error"] ?? "")).toContain("timeout");
    } finally {
      db.close();
    }
  }, 60000);
});
