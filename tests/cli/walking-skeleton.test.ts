import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { git, cli } from "../helpers.ts";
import { GitRepoImpl } from "../../src/infrastructure/git/git-repo.ts";
import type { GitRunResult } from "../../src/infrastructure/git/git-repo.ts";

interface Fixture { root: string; home: string; origin: string; work: string; work2: string; dbPath: string; }

async function commitFile(cwd: string, name: string): Promise<void> {
  writeFileSync(join(cwd, name), name + "\n");
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", name);
}
async function branch(cwd: string, name: string, from: string): Promise<void> {
  await git(cwd, "checkout", from);
  await git(cwd, "checkout", "-b", name);
  await commitFile(cwd, name + ".txt");
  await git(cwd, "push", "origin", name);
}
async function makeFixture(prefix: string): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, "home"); const origin = join(root, "origin.git"); const work = join(root, "work"); const work2 = join(root, "work2");
  await git(root, "init", "--bare", origin);
  await git(root, "clone", origin, work);
  await git(work, "config", "user.email", "t@t.t"); await git(work, "config", "user.name", "T");
  await git(work, "checkout", "-b", "main");
  await commitFile(work, "main.txt");
  await git(work, "push", "-u", "origin", "main");
  await branch(work, "A", "main"); await branch(work, "F", "A"); await branch(work, "C", "main"); await branch(work, "B", "C"); await branch(work, "D", "C");
  await git(root, "clone", origin, work2);
  await git(work2, "config", "user.email", "t@t.t"); await git(work2, "config", "user.name", "T");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({ repos: [{ name: "x", path: work, bases: { A: "main", F: "A", C: "main", B: "C", D: "C" } }] }));
  return { root, home, origin, work, work2, dbPath: join(home, "kitchen.db") };
}
async function pushToC(f: Fixture): Promise<void> {
  await git(f.work2, "checkout", "C");
  await commitFile(f.work2, "c2.txt");
  await git(f.work2, "push", "origin", "C");
}
function readRows(dbPath: string, table: string): Record<string, unknown>[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare("SELECT * FROM " + table).all(); } finally { db.close(); }
}
function text(r: Record<string, unknown>, k: string): string { const v = r[k]; if (typeof v !== "string") throw new Error(k); return v; }
async function notices(f: Fixture): Promise<{ notices: { repo: string; branch: string; base: string; evidence: string; status: string; behindBy: number; lastEventId: string }[] }> {
  const r = await cli(f.home, "notices", "--json");
  expect(r.code).toBe(0);
  return JSON.parse(r.stdout) as { notices: { repo: string; branch: string; base: string; evidence: string; status: string; behindBy: number; lastEventId: string }[] };
}

describe("walking skeleton", () => {
  it("push to base marks children behind", async () => {
    const f = await makeFixture("tk-walk-");
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    await pushToC(f);
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    const out = await notices(f);
    const events = readRows(f.dbPath, "event");
    expect(events).toHaveLength(1);
    const eventId = text(events[0] ?? {}, "id");
    expect(out.notices).toEqual([
      { repo: "x", branch: "B", base: "C", evidence: "explicit", status: "behind", behindBy: 1, lastEventId: eventId },
      { repo: "x", branch: "D", base: "C", evidence: "explicit", status: "behind", behindBy: 1, lastEventId: eventId },
    ]);
    expect(JSON.parse(text(events[0] ?? {}, "threads"))).toEqual(["git:x:B", "git:x:D"]);
    expect(readRows(f.dbPath, "disposition")).toHaveLength(2);
  }, 60000);

  it("first round writes no trigger but fills branch_state", async () => {
    const f = await makeFixture("tk-first-");
    await pushToC(f);
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    expect(readRows(f.dbPath, "event")).toHaveLength(0);
    expect(readRows(f.dbPath, "disposition")).toHaveLength(0);
    const out = await notices(f);
    const b = out.notices.find((n) => n.branch === "B");
    expect(b?.status).toBe("behind"); expect(b?.behindBy).toBe(1);
    expect(readRows(f.dbPath, "branch_state").length).toBeGreaterThan(0);
  }, 60000);

  it("rerun with no push adds no rows", async () => {
    const f = await makeFixture("tk-quiet-");
    await cli(f.home, "round", "--repo", "x");
    await pushToC(f);
    await cli(f.home, "round", "--repo", "x");
    const beforeE = readRows(f.dbPath, "event").length; const beforeD = readRows(f.dbPath, "disposition").length;
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    expect(readRows(f.dbPath, "event")).toHaveLength(beforeE);
    expect(readRows(f.dbPath, "disposition")).toHaveLength(beforeD);
  }, 60000);

  it("child merge closes notice", async () => {
    const f = await makeFixture("tk-close-");
    await cli(f.home, "round", "--repo", "x");
    await pushToC(f);
    await cli(f.home, "round", "--repo", "x");
    await git(f.work, "fetch", "origin");
    await git(f.work, "checkout", "B");
    await git(f.work, "merge", "--no-edit", "origin/C");
    await git(f.work, "push", "origin", "B");
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    const out = await notices(f);
    expect(out.notices.map((n) => n.branch)).not.toContain("B");
    const row = readRows(f.dbPath, "branch_state").find((r) => text(r, "branch") === "B");
    expect(row !== undefined && text(row, "status")).toBe("up_to_date");
  }, 60000);

  it("round runs only read commands", async () => {
    const f = await makeFixture("tk-readonly-");
    void f.root;
    const before = await git(f.origin, "for-each-ref");
    await cli(f.home, "round", "--repo", "x");
    const after = await git(f.origin, "for-each-ref");
    expect(after).toBe(before);
    const verbs: string[] = [];
    const runner = async (args: string[]): Promise<GitRunResult> => {
      verbs.push(args[0] ?? "");
      if (args[0] === "ls-remote") return { stdout: "ref: refs/heads/main HEAD\n" + "a".repeat(40) + "\trefs/heads/main\n", stderr: "", code: 0 };
      if (args[0] === "merge-base") return { stdout: "", stderr: "", code: 1 };
      if (args[0] === "rev-list") return { stdout: "0\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    };
    const repo = new GitRepoImpl(f.work, runner);
    await repo.lsRemoteHeads("origin"); await repo.fetch("origin"); await repo.isAncestor("a", "b"); await repo.countBehind("a", "b");
    expect(new Set(verbs)).toEqual(new Set(["ls-remote", "fetch", "merge-base", "rev-list"]));
  }, 60000);
});
