import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, cli } from "../helpers.ts";

interface Fixture { home: string; work: string; work2: string; }

async function commitFile(cwd: string, name: string): Promise<void> {
  writeFileSync(join(cwd, name), name + "\n");
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", name);
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
  await git(work, "checkout", "-b", "C");
  await commitFile(work, "c.txt");
  await git(work, "push", "origin", "C");
  await git(work, "checkout", "-b", "B");
  await commitFile(work, "b.txt");
  await git(work, "push", "origin", "B");
  await git(root, "clone", origin, work2);
  await git(work2, "config", "user.email", "t@t.t"); await git(work2, "config", "user.name", "T");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({ repos: [{ name: "x", path: work, bases: { B: "C" } }] }));
  return { home, work, work2 };
}

async function pushToC(f: Fixture, name: string): Promise<void> {
  await git(f.work2, "checkout", "C");
  await commitFile(f.work2, name);
  await git(f.work2, "push", "origin", "C");
}

async function round(f: Fixture): Promise<void> {
  expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
}

async function makeThree(f: Fixture): Promise<void> {
  await round(f);
  await pushToC(f, "c2.txt"); await round(f);
  await pushToC(f, "c3.txt"); await round(f);
  await pushToC(f, "c4.txt"); await round(f);
}

type Line = Record<string, unknown>;
function parse(stdout: string): Line[] {
  return stdout.trim().split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Line);
}
function cursorOf(obj: unknown): string { return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url"); }
function collectKeys(value: unknown, into: Set<string>): void {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) { for (const v of value) collectKeys(v, into); return; }
  for (const [k, v] of Object.entries(value)) { into.add(k); collectKeys(v, into); }
}

describe("export", () => {
  it("full export", async () => {
    const f = await makeFixture("tk-export-full-");
    await makeThree(f);
    const r = await cli(f.home, "export", "--json");
    expect(r.code).toBe(0);
    const lines = parse(r.stdout);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatchObject({ type: "header", schema: "tkitchen.export/1", reset: false });
    expect(typeof lines[0]?.["machine"]).toBe("string");
    expect(lines.slice(1, 4).map((l) => l["type"])).toEqual(["event", "event", "event"]);
    expect(lines.slice(1, 4).map((l) => l["seq"])).toEqual([1, 2, 3]);
    expect(lines[1]).toMatchObject({ source: "git", actor: "git", human: false, threads: ["git:x:B"] });
    expect(lines[4]).toMatchObject({ type: "end", events: 3 });
    expect(typeof lines[4]?.["cursor"]).toBe("string");
  }, 60000);

  it("after cursor streams only newer", async () => {
    const f = await makeFixture("tk-export-resume-");
    await makeThree(f);
    const first = parse((await cli(f.home, "export", "--json")).stdout);
    const cursor = String(first[4]?.["cursor"]);
    await pushToC(f, "c5.txt"); await round(f);
    const r = await cli(f.home, "export", "--json", "--after", cursor);
    expect(r.code).toBe(0);
    const lines = parse(r.stdout);
    expect(lines[0]).toMatchObject({ type: "header", reset: false });
    const events = lines.filter((l) => l["type"] === "event");
    expect(events).toHaveLength(1);
    expect(events[0]?.["seq"]).toBe(4);
    expect(lines[lines.length - 1]).toMatchObject({ type: "end", events: 1 });
  }, 60000);

  it("missing seq and changed id are resets", async () => {
    const f = await makeFixture("tk-export-reset-");
    await makeThree(f);
    for (const cursor of [cursorOf({ s: 99, id: "missing" }), cursorOf({ s: 1, id: "other" })]) {
      const r = await cli(f.home, "export", "--json", "--after", cursor);
      expect(r.code).toBe(0);
      const lines = parse(r.stdout);
      expect(lines[0]).toMatchObject({ type: "header", reset: true });
      expect(lines.filter((l) => l["type"] === "event").map((l) => l["seq"])).toEqual([1, 2, 3]);
    }
  }, 60000);

  it("empty store", async () => {
    const f = await makeFixture("tk-export-empty-");
    await round(f);
    const r = await cli(f.home, "export", "--json");
    expect(r.code).toBe(0);
    const lines = parse(r.stdout);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: "header", reset: false });
    expect(lines[1]).toMatchObject({ type: "end", events: 0 });
    expect(JSON.parse(Buffer.from(String(lines[1]?.["cursor"]), "base64url").toString("utf8"))).toEqual({ s: 0, id: null });
  }, 60000);

  it("bad cursor", async () => {
    const f = await makeFixture("tk-export-bad-");
    await round(f);
    const r = await cli(f.home, "export", "--json", "--after", "not-base64");
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("invalid cursor");
  }, 60000);

  it("no per-machine tables exported", async () => {
    const f = await makeFixture("tk-export-rbonly-");
    await makeThree(f);
    const r = await cli(f.home, "export", "--json");
    expect(r.code).toBe(0);
    const lines = parse(r.stdout);
    expect(new Set(lines.map((l) => l["type"]))).toEqual(new Set(["header", "event", "end"]));
    const keys = new Set<string>();
    for (const line of lines) collectKeys(line, keys);
    for (const forbidden of ["outcome", "status", "behind_by", "oid", "consumer", "disposition", "branch_state", "repo_heads", "round_status"]) expect(keys.has(forbidden)).toBe(false);
  }, 60000);
});
