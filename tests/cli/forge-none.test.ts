import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, cli } from "../helpers.ts";

interface Notice {
  repo: string;
  branch: string;
  base: string | null;
  evidence: string | null;
  status: string;
}
interface Rounds {
  repo: string;
  lastCompleteAt: string | null;
  lastError: string | null;
}

const saved = { fail: process.env["FAKE_GH_FAIL"], prs: process.env["FAKE_GH_PRS_FILE"] };
afterEach(() => {
  if (saved.fail === undefined) delete process.env["FAKE_GH_FAIL"];
  else process.env["FAKE_GH_FAIL"] = saved.fail;
  if (saved.prs === undefined) delete process.env["FAKE_GH_PRS_FILE"];
  else process.env["FAKE_GH_PRS_FILE"] = saved.prs;
});

async function commitFile(cwd: string, name: string): Promise<void> {
  writeFileSync(join(cwd, name), name + "\n");
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", name);
}
async function makeFixture(prefix: string, forge: string): Promise<{ root: string; home: string; work: string }> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, "home");
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  await git(root, "init", "--bare", "-b", "main", origin);
  await git(root, "clone", origin, work);
  await git(work, "config", "user.email", "t@t.t");
  await git(work, "config", "user.name", "T");
  await git(work, "config", "commit.gpgsign", "false");
  await git(work, "checkout", "-b", "main");
  await commitFile(work, "main.txt");
  await git(work, "push", "-u", "origin", "main");
  await git(work, "switch", "-c", "C", "origin/main");
  await commitFile(work, "c1.txt");
  await git(work, "push", "-u", "origin", "C");
  await git(work, "switch", "-c", "B", "origin/C");
  await commitFile(work, "b1.txt");
  await git(work, "push", "-u", "origin", "B");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({ repos: [{ name: "x", path: work, forge }] }));
  return { root, home, work };
}

async function moveBases(work: string): Promise<void> {
  for (const b of ["C", "main"]) {
    await git(work, "switch", b);
    await commitFile(work, b + "-moved.txt");
    await git(work, "push", "origin", b);
  }
}

describe("forge none", () => {
  it("never runs gh: a failing gh still completes the Round", async () => {
    const f = await makeFixture("tk-forgenone-", "none");
    process.env["FAKE_GH_FAIL"] = "1";
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    await moveBases(f.work);
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    const out = JSON.parse((await cli(f.home, "notices", "--json")).stdout) as { rounds: Rounds[]; notices: Notice[] };
    expect(out.rounds.find((r) => r.repo === "x")).toMatchObject({ lastError: null });
    expect(out.rounds.find((r) => r.repo === "x")?.lastCompleteAt).not.toBeNull();
    expect(out.notices.find((n) => n.branch === "B")).toMatchObject({ base: "C", evidence: "reflog" });
  }, 60000);

  async function prRound(forge: string): Promise<Notice | undefined> {
    const f = await makeFixture("tk-forge-pr-", forge);
    const prs = join(f.root, "prs.json");
    writeFileSync(
      prs,
      JSON.stringify([
        {
          number: 1,
          headRefName: "B",
          baseRefName: "main",
          url: "https://example.invalid/pr/1",
          author: { login: "t" },
          isCrossRepository: false,
        },
      ]),
    );
    process.env["FAKE_GH_PRS_FILE"] = prs;
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    await moveBases(f.work);
    expect((await cli(f.home, "round", "--repo", "x")).code).toBe(0);
    const out = JSON.parse((await cli(f.home, "notices", "--json")).stdout) as { notices: Notice[] };
    return out.notices.find((n) => n.branch === "B");
  }
  it("ignores open PRs and keeps the reflog base", async () => {
    expect(await prRound("none")).toMatchObject({ base: "C", evidence: "reflog" });
    expect(await prRound("github")).toMatchObject({ base: "main", evidence: "pr" });
  }, 60000);

  it("an unknown forge exits 2 naming repos[0].forge", async () => {
    const f = await makeFixture("tk-forgebad-", "gitlab");
    const r = await cli(f.home, "round", "--repo", "x");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("repos[0].forge");
  }, 60000);
});
