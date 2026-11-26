import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { git, cli } from "../../testing/adapters.ts";

const FAKE_GH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "fake-gh");

interface Fixture {
  root: string;
  home: string;
  origin: string;
  work: string;
  work2: string;
  dbPath: string;
  prsFile: string;
}
interface GhPr {
  number: number;
  headRefName: string;
  baseRefName: string;
  url: string;
  author: { login: string };
  isCrossRepository: boolean;
}
interface Notice {
  repo: string;
  branch: string;
  base: string | null;
  evidence: string | null;
  status: string;
  behindBy: number | null;
}

function ghPr(number: number, head: string, base: string, crossRepository = false): GhPr {
  return {
    number,
    headRefName: head,
    baseRefName: base,
    url: "https://example.invalid/pr/" + number,
    author: { login: "teammate" },
    isCrossRepository: crossRepository,
  };
}
function setPrs(f: Fixture, prs: GhPr[]): void {
  writeFileSync(f.prsFile, JSON.stringify(prs));
}
async function commitFile(cwd: string, name: string): Promise<void> {
  writeFileSync(join(cwd, name), name + "\n");
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", name);
}
function installFakeGh(f: Fixture): () => void {
  const savedPath = process.env["PATH"];
  const savedFile = process.env["FAKE_GH_PRS_FILE"];
  const savedFail = process.env["FAKE_GH_FAIL"];
  process.env["PATH"] = FAKE_GH_DIR + delimiter + (savedPath ?? "");
  process.env["FAKE_GH_PRS_FILE"] = f.prsFile;
  delete process.env["FAKE_GH_FAIL"];
  return () => {
    if (savedPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = savedPath;
    if (savedFile === undefined) delete process.env["FAKE_GH_PRS_FILE"];
    else process.env["FAKE_GH_PRS_FILE"] = savedFile;
    if (savedFail === undefined) delete process.env["FAKE_GH_FAIL"];
    else process.env["FAKE_GH_FAIL"] = savedFail;
  };
}
async function setupWork(cwd: string): Promise<void> {
  await git(cwd, "config", "user.email", "t@t.t");
  await git(cwd, "config", "user.name", "T");
  await git(cwd, "config", "commit.gpgsign", "false");
}
async function makeFixture(prefix: string, bases: Record<string, string> = {}): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, "home");
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  const work2 = join(root, "work2");
  await git(root, "init", "--bare", "-b", "main", origin);
  await git(root, "clone", origin, work);
  await setupWork(work);
  await git(work, "checkout", "-b", "main");
  await commitFile(work, "main.txt");
  await git(work, "push", "-u", "origin", "main");
  await git(work, "checkout", "-b", "feature-1");
  await commitFile(work, "f1.txt");
  await git(work, "push", "-u", "origin", "feature-1");
  await git(root, "clone", origin, work2);
  await setupWork(work2);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({ repos: [{ name: "x", path: work, bases }] }));
  const prsFile = join(root, "prs.json");
  writeFileSync(prsFile, "[]");
  return { root, home, origin, work, work2, dbPath: join(home, "kitchen.db"), prsFile };
}
async function makeOtherMachineBranch(f: Fixture, name: string, from: string): Promise<void> {
  await git(f.work2, "fetch", "origin");
  await git(f.work2, "switch", "-C", name, "origin/" + from);
  await commitFile(f.work2, name + ".txt");
  await git(f.work2, "push", "-u", "origin", name);
}
async function pushToFeature1(f: Fixture): Promise<void> {
  await git(f.work2, "fetch", "origin");
  await git(f.work2, "switch", "-C", "feature-1-push", "origin/feature-1");
  await commitFile(f.work2, "f1-more.txt");
  await git(f.work2, "push", "origin", "HEAD:feature-1");
}
async function notices(
  f: Fixture,
): Promise<{ notices: Notice[]; rounds: { repo: string; lastError: string | null }[] }> {
  const r = await cli(f.home, "notices", "--json");
  expect(r.code).toBe(0);
  return JSON.parse(r.stdout) as { notices: Notice[]; rounds: { repo: string; lastError: string | null }[] };
}
function snapshot(f: Fixture): string {
  const db = new DatabaseSync(f.dbPath, { readOnly: true });
  try {
    const out: Record<string, unknown[]> = {};
    for (const table of ["event", "disposition", "branch_state", "repo_heads"])
      out[table] = db.prepare("SELECT * FROM " + table + " ORDER BY 1, 2, 3").all();
    return JSON.stringify(out);
  } finally {
    db.close();
  }
}
function branchState(f: Fixture, branch: string): Record<string, unknown> | undefined {
  const db = new DatabaseSync(f.dbPath, { readOnly: true });
  try {
    return (db.prepare("SELECT * FROM branch_state WHERE branch = ?").all(branch) as Record<string, unknown>[])[0];
  } finally {
    db.close();
  }
}

describe("pr bases", () => {
  it("teammate branch gets its base from a PR", async () => {
    const f = await makeFixture("tk-pr-");
    const restore = installFakeGh(f);
    try {
      await makeOtherMachineBranch(f, "feature-2", "feature-1");
      setPrs(f, [ghPr(1, "feature-2", "feature-1")]);
      expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
      await pushToFeature1(f);
      expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
      const out = await notices(f);
      const n = out.notices.find((x) => x.branch === "feature-2");
      expect(n).toMatchObject({ base: "feature-1", evidence: "pr", status: "behind", behindBy: 1 });
    } finally {
      restore();
    }
  }, 60000);

  it("retarget is seen without a push", async () => {
    const f = await makeFixture("tk-pr-retarget-");
    const restore = installFakeGh(f);
    try {
      await makeOtherMachineBranch(f, "feature-2", "feature-1");
      setPrs(f, [ghPr(1, "feature-2", "feature-1")]);
      expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
      expect(branchState(f, "feature-2")?.["base"]).toBe("feature-1");
      setPrs(f, [ghPr(1, "feature-2", "main")]);
      expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
      expect(branchState(f, "feature-2")?.["base"]).toBe("main");
    } finally {
      restore();
    }
  }, 60000);

  it("gh failure changes nothing", async () => {
    const f = await makeFixture("tk-pr-fail-");
    const restore = installFakeGh(f);
    try {
      await makeOtherMachineBranch(f, "feature-2", "feature-1");
      setPrs(f, [ghPr(1, "feature-2", "feature-1")]);
      expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
      const before = snapshot(f);
      await pushToFeature1(f);
      process.env["FAKE_GH_FAIL"] = "1";
      expect((await cli(f.home, "round", "--repo", "x")).code).toBe(1);
      delete process.env["FAKE_GH_FAIL"];
      expect(snapshot(f)).toBe(before);
      const failed = await notices(f);
      expect(failed.rounds.find((r) => r.repo === "x")?.lastError).not.toBeNull();
      expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
      const out = await notices(f);
      expect(out.notices.find((x) => x.branch === "feature-2")).toMatchObject({
        base: "feature-1",
        evidence: "pr",
        status: "behind",
        behindBy: 1,
      });
    } finally {
      restore();
    }
  }, 60000);

  it("fork and ambiguous prs", async () => {
    const forkFixture = await makeFixture("tk-pr-fork-");
    const restoreFork = installFakeGh(forkFixture);
    try {
      await makeOtherMachineBranch(forkFixture, "feature-2", "feature-1");
      setPrs(forkFixture, [ghPr(1, "feature-2", "feature-1", true)]);
      expect((await cli(forkFixture.home, "round", "--repo", "x")).code).toBe(0);
      const out = await notices(forkFixture);
      expect(out.notices.find((x) => x.branch === "feature-2")).toMatchObject({ base: null, status: "needs_base" });
    } finally {
      restoreFork();
    }

    const mismatchFixture = await makeFixture("tk-pr-mismatch-", { X: "C" });
    const restoreMismatch = installFakeGh(mismatchFixture);
    try {
      await git(mismatchFixture.work, "checkout", "-b", "C", "main");
      await commitFile(mismatchFixture.work, "c.txt");
      await git(mismatchFixture.work, "push", "-u", "origin", "C");
      await git(mismatchFixture.work, "checkout", "-b", "D", "main");
      await commitFile(mismatchFixture.work, "d.txt");
      await git(mismatchFixture.work, "push", "-u", "origin", "D");
      await makeOtherMachineBranch(mismatchFixture, "X", "C");
      setPrs(mismatchFixture, [ghPr(1, "X", "D")]);
      expect((await cli(mismatchFixture.home, "round", "--repo", "x")).code).toBe(0);
      const out = await notices(mismatchFixture);
      expect(out.notices.find((x) => x.branch === "X")).toMatchObject({
        base: null,
        status: "ambiguous",
        evidence: "explicit_pr_mismatch",
      });
    } finally {
      restoreMismatch();
    }

    const dupFixture = await makeFixture("tk-pr-dup-");
    const restoreDup = installFakeGh(dupFixture);
    try {
      await makeOtherMachineBranch(dupFixture, "feature-2", "feature-1");
      setPrs(dupFixture, [ghPr(1, "feature-2", "feature-1"), ghPr(2, "feature-2", "main")]);
      expect((await cli(dupFixture.home, "round", "--repo", "x")).code).toBe(0);
      const out = await notices(dupFixture);
      expect(out.notices.find((x) => x.branch === "feature-2")).toMatchObject({
        base: null,
        status: "ambiguous",
        evidence: "multiple_prs",
      });
    } finally {
      restoreDup();
    }
  }, 120000);
});
