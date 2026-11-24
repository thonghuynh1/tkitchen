import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { GitRepo } from "../../src/application/ports.ts";

export interface Scripting {
  advance: (branch: string) => Promise<string>;
  branchFrom: (name: string, fromBranch: string) => Promise<void>;
  branchLocalNamed: (name: string, fromBranch: string) => Promise<void>;
  branchLocalCommit: (name: string, fromBranch: string) => Promise<string>;
  branchOtherMachine: (name: string, fromBranch: string) => Promise<void>;
  dispose: () => Promise<void>;
}
export type ScriptedGitRepo = GitRepo & Scripting;

const MAIN_REF = "refs/remotes/origin/main";
const FEATURE_REF = "refs/remotes/origin/feature";

export function gitRepoContract(name: string, make: () => Promise<ScriptedGitRepo>): void {
  describe(name, () => {
    let repo: ScriptedGitRepo;
    beforeEach(async () => { repo = await make(); });
    afterEach(async () => { await repo.dispose(); });

    it("lsRemoteHeads heads and defaultBranch", async () => {
      await repo.branchFrom("feature", "main");
      const { heads, defaultBranch } = await repo.lsRemoteHeads("origin");
      expect(defaultBranch).toBe("main");
      expect(heads.get("main")).toBeDefined();
      expect(heads.get("feature")).toBe(heads.get("main"));
      expect(heads.size).toBe(2);
    }, 60000);

    it("heads unchanged until fetch for ancestry", async () => {
      await repo.branchFrom("feature", "main");
      await repo.fetch("origin");
      const newMain = await repo.advance("main");
      const { heads } = await repo.lsRemoteHeads("origin");
      expect(heads.get("main")).toBe(newMain);
      expect(await repo.countBehind(FEATURE_REF, MAIN_REF)).toBe(0);
      await repo.fetch("origin");
      expect(await repo.countBehind(FEATURE_REF, MAIN_REF)).toBe(1);
    }, 60000);

    it("isAncestor true/false", async () => {
      await repo.branchFrom("feature", "main");
      await repo.branchFrom("root", "main");
      await repo.advance("feature");
      await repo.advance("main");
      await repo.fetch("origin");
      expect(await repo.isAncestor("refs/remotes/origin/root", FEATURE_REF)).toBe(true);
      expect(await repo.isAncestor(MAIN_REF, FEATURE_REF)).toBe(false);
      expect(await repo.isAncestor(FEATURE_REF, MAIN_REF)).toBe(false);
      expect(await repo.isAncestor(MAIN_REF, MAIN_REF)).toBe(true);
    }, 60000);

    it("creationReflog named, commit, and none", async () => {
      await repo.branchLocalNamed("named", "main");
      const named = await repo.creationReflog("named");
      expect(named).not.toBeNull();
      expect(named?.createdFrom).toContain("main");
      const commitOid = await repo.branchLocalCommit("bycommit", "main");
      const commit = await repo.creationReflog("bycommit");
      expect(commit).not.toBeNull();
      expect(commit?.oid).toBe(commitOid);
      expect(commitOid.startsWith(commit?.createdFrom ?? "")).toBe(true);
      await repo.branchOtherMachine("elsewhere", "main");
      expect(await repo.creationReflog("elsewhere")).toBeNull();
      expect(await repo.creationReflog("main")).toBeNull();
    }, 60000);

    it("tipAt before and after creation", async () => {
      await repo.branchLocalNamed("cand", "main");
      const cand = await repo.creationReflog("cand");
      expect(cand).not.toBeNull();
      if (cand === null) return;
      expect(await repo.tipAt("refs/heads/cand", cand.unixSeconds - 1)).toBeNull();
      expect(await repo.tipAt("refs/heads/cand", cand.unixSeconds)).toBe(cand.oid);
      await repo.branchLocalCommit("child", "cand");
      const child = await repo.creationReflog("child");
      expect(child).not.toBeNull();
      if (child === null) return;
      expect(await repo.tipAt("refs/heads/cand", child.unixSeconds)).toBe(child.oid);
    }, 60000);

    it("countBehind 0, 1, 3", async () => {
      await repo.branchFrom("feature", "main");
      await repo.fetch("origin");
      expect(await repo.countBehind(FEATURE_REF, MAIN_REF)).toBe(0);
      await repo.advance("main");
      await repo.fetch("origin");
      expect(await repo.countBehind(FEATURE_REF, MAIN_REF)).toBe(1);
      await repo.advance("main");
      await repo.advance("main");
      await repo.fetch("origin");
      expect(await repo.countBehind(FEATURE_REF, MAIN_REF)).toBe(3);
    }, 60000);
  });
}
