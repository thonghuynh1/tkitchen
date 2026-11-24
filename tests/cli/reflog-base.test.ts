import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, cli } from "../helpers.ts";

interface Fixture { root: string; home: string; origin: string; work: string; work2: string; }

async function commitFile(cwd: string, name: string): Promise<void> {
  writeFileSync(join(cwd, name), name + "\n");
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", name);
}

async function makeFixture(prefix: string): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, "home"); const origin = join(root, "origin.git"); const work = join(root, "work"); const work2 = join(root, "work2");
  await git(root, "init", "--bare", "-b", "main", origin);
  await git(root, "clone", origin, work);
  await git(work, "config", "user.email", "t@t.t"); await git(work, "config", "user.name", "T"); await git(work, "config", "commit.gpgsign", "false");
  await git(work, "checkout", "-b", "main");
  await commitFile(work, "main.txt");
  await git(work, "push", "-u", "origin", "main");
  await git(work, "checkout", "-b", "C");
  await commitFile(work, "c1.txt");
  await git(work, "push", "-u", "origin", "C");
  await git(work, "switch", "-c", "B", "origin/C");
  await commitFile(work, "b1.txt");
  await git(work, "push", "-u", "origin", "B");
  const cTip = (await git(work, "rev-parse", "origin/C")).trim();
  await git(work, "branch", "E", cTip);
  await git(work, "switch", "E");
  await commitFile(work, "e1.txt");
  await git(work, "push", "-u", "origin", "E");
  await git(root, "clone", origin, work2);
  await git(work2, "config", "user.email", "t@t.t"); await git(work2, "config", "user.name", "T"); await git(work2, "config", "commit.gpgsign", "false");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({ repos: [{ name: "x", path: work, bases: {} }] }));
  return { root, home, origin, work, work2 };
}

async function pushToC(f: Fixture): Promise<void> {
  await git(f.work2, "checkout", "C");
  await commitFile(f.work2, "c2.txt");
  await git(f.work2, "push", "origin", "C");
}

interface Notice { repo: string; branch: string; base: string | null; evidence: string | null; status: string; behindBy: number | null; lastEventId: string | null; }

describe("reflog bases", () => {
  it("reflog and reflog-tip branches are behind after base moves", async () => {
    const f = await makeFixture("tk-reflog-");
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    await pushToC(f);
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    const r = await cli(f.home, "notices", "--json");
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout) as { notices: Notice[] };
    const b = out.notices.find((n) => n.branch === "B");
    const e = out.notices.find((n) => n.branch === "E");
    expect(b).toMatchObject({ base: "C", evidence: "reflog", status: "behind", behindBy: 1 });
    expect(e).toMatchObject({ base: "C", evidence: "reflog-tip", status: "behind", behindBy: 1 });
  }, 60000);

  it("branch created from a foreign remote ref is needs_base", async () => {
    const f = await makeFixture("tk-foreign-");
    const mainTip = (await git(f.work, "rev-parse", "origin/main")).trim();
    await git(f.work, "update-ref", "refs/remotes/foreign/C", mainTip);
    await git(f.work, "switch", "-c", "H", "refs/remotes/foreign/C");
    await commitFile(f.work, "h1.txt");
    await git(f.work, "push", "-u", "origin", "H");
    await pushToC(f);
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    const r = await cli(f.home, "notices", "--json");
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout) as { notices: Notice[] };
    const h = out.notices.find((n) => n.branch === "H");
    expect(h).toMatchObject({ base: null, status: "needs_base", behindBy: null });
  }, 60000);

  it("branch pushed from another clone is needs_base", async () => {
    const f = await makeFixture("tk-needsbase-");
    await git(f.work2, "fetch", "origin");
    await git(f.work2, "switch", "-c", "G", "origin/C");
    await commitFile(f.work2, "g1.txt");
    await git(f.work2, "push", "-u", "origin", "G");
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    const r = await cli(f.home, "notices");
    expect(r.code).toBe(0);
    const line = r.stdout.split("\n").find((l) => l.includes(" G "));
    expect(line).toContain("needs_base");
    expect(line).toContain("add \"bases\": { \"G\": \"<base>\" } to " + join(f.home, "config.json"));
  }, 60000);

  it("history lists triggers with dispositions", async () => {
    const f = await makeFixture("tk-history-");
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    await pushToC(f);
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    const r = await cli(f.home, "notices", "--json", "--history");
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout) as { history: { event: { id: string; threads: string[] }; dispositions: { thread: string; outcome: string; meta: { behindBy: number } }[] }[] };
    expect(out.history).toHaveLength(1);
    const entry = out.history[0];
    expect(entry?.dispositions.map((d) => d.thread).sort()).toEqual(["git:x:B", "git:x:E"]);
    expect(entry?.dispositions.every((d) => d.meta.behindBy === 1)).toBe(true);
  }, 60000);
});
