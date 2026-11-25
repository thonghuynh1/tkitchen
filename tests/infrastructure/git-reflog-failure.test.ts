import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../helpers.ts";
import { GitRepoImpl } from "../../src/modules/git/adapters.ts";
import type { GitRunResult } from "../../src/modules/git/adapters.ts";
import { PortError } from "../../src/modules/platform/index.ts";

const FATAL: GitRunResult = { stdout: "", stderr: "fatal: unable to read reflog: Permission denied", code: 128 };
const ABSENT: GitRunResult = { stdout: "", stderr: "fatal: ambiguous argument 'refs/heads/nope': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'", code: 128 };

describe("git reflog failure classification", () => {
  it("fatal reflog exit raises PortError failed from creationReflog and tipAt", async () => {
    const repo = new GitRepoImpl("unused", async () => FATAL);
    let creation: unknown = null;
    try { await repo.creationReflog("feature"); } catch (e) { creation = e; }
    expect(creation).toBeInstanceOf(PortError);
    expect(creation instanceof PortError ? creation.kind : "").toBe("failed");
    expect(creation instanceof Error ? creation.message : "").toContain("reflog");
    let tip: unknown = null;
    try { await repo.tipAt("refs/heads/main", 1); } catch (e) { tip = e; }
    expect(tip).toBeInstanceOf(PortError);
    expect(tip instanceof PortError ? tip.kind : "").toBe("failed");
  });

  it("legitimately absent reflog still returns null from both methods", async () => {
    const repo = new GitRepoImpl("unused", async () => ABSENT);
    expect(await repo.creationReflog("nope")).toBeNull();
    expect(await repo.tipAt("refs/heads/nope", 1)).toBeNull();
    const empty = new GitRepoImpl("unused", async () => ({ stdout: "", stderr: "", code: 0 }));
    expect(await empty.creationReflog("main")).toBeNull();
    expect(await empty.tipAt("refs/heads/main", 1)).toBeNull();
  });

  it("real git: a branch with no local reflog returns null, not an error", async () => {
    const root = mkdtempSync(join(tmpdir(), "tk-reflog-absent-"));
    await git(root, "init", "-b", "main", "repo");
    const repoPath = join(root, "repo");
    await git(repoPath, "config", "user.email", "t@t.t");
    await git(repoPath, "config", "user.name", "T");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(repoPath, "f.txt"), "f\n");
    await git(repoPath, "add", ".");
    await git(repoPath, "commit", "-m", "one");
    const repo = new GitRepoImpl(repoPath);
    expect(await repo.creationReflog("never-created-locally")).toBeNull();
    expect(await repo.tipAt("refs/heads/never-created-locally", 1)).toBeNull();
  }, 30000);
});
