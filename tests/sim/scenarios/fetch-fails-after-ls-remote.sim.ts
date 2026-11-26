import { describe, it, expect } from "vitest";
import { groundTruth } from "../oracles/ground-truth.ts";
import { incompleteChangesNothing } from "../oracles/incomplete-changes-nothing.ts";
import { SimWorld } from "../world/world.ts";
import { pumpRound } from "./run-round.ts";

describe("pinned scenario: fetch fails after ls-remote changed (fixed seed 6102)", () => {
  it("failing Round changes nothing and the next Round records the move", async () => {
    const world = new SimWorld(6102);
    try {
      world.remote.createBranch("C", "main");
      world.remote.commitOn("C");
      world.remote.createBranch("B", "C");
      world.remote.commitOn("B");
      world.remote.createBranch("D", "C");
      world.remote.commitOn("D");
      world.config.setBase("C", "main");
      world.config.setBase("B", "C");
      world.config.setBase("D", "C");
      expect((await pumpRound(world)).ok).toBe(true);
      const headsBefore = world.store.listRepoHeadRows();
      const snapshotBefore = world.snapshotStore();
      world.remote.commitOn("C");
      world.remote.failNextGit("fetch", "failed");
      expect((await pumpRound(world)).ok).toBe(false);
      expect(world.store.listRepoHeadRows()).toEqual(headsBefore);
      world.incompleteSnapshot = snapshotBefore;
      expect(incompleteChangesNothing.check(world)).toEqual([]);
      world.incompleteSnapshot = null;
      expect(world.store.listRoundStatus()[0]?.lastError).toContain("fetch");
      expect((await pumpRound(world)).ok).toBe(true);
      expect(world.store.listRepoHeadRows()).not.toEqual(headsBefore);
      expect(world.store.listTriggers()).toHaveLength(1);
      for (const child of ["B", "D"]) {
        const state = world.store.listBranchStates().find((s) => s.branch === child);
        expect(state?.status).toBe("behind");
        expect(state?.behindBy).toBe(1);
      }
      expect(groundTruth.check(world)).toEqual([]);
    } finally {
      world.dispose();
    }
  }, 120000);

  it("deleted branch closes its notice on the next complete Round", async () => {
    const world = new SimWorld(6104);
    try {
      world.remote.createBranch("C", "main");
      world.remote.commitOn("C");
      world.remote.createBranch("B", "C");
      world.remote.commitOn("B");
      world.config.setBase("C", "main");
      world.config.setBase("B", "C");
      expect((await pumpRound(world)).ok).toBe(true);
      world.remote.commitOn("C");
      expect((await pumpRound(world)).ok).toBe(true);
      expect(world.store.listBranchStates().find((s) => s.branch === "B")?.status).toBe("behind");
      world.remote.deleteBranch("B");
      expect((await pumpRound(world)).ok).toBe(true);
      expect(world.store.listBranchStates().some((s) => s.branch === "B")).toBe(false);
      expect(groundTruth.check(world)).toEqual([]);
    } finally {
      world.dispose();
    }
  }, 120000);

  it("git timeout on any method makes the Round incomplete", async () => {
    const world = new SimWorld(6103);
    try {
      world.remote.createBranch("feature", "main");
      world.remote.commitOn("feature");
      world.config.setBase("feature", "main");
      expect((await pumpRound(world)).ok).toBe(true);
      const snapshotBefore = world.snapshotStore();
      world.remote.timeoutNextGit("lsRemoteHeads");
      expect((await pumpRound(world)).ok).toBe(false);
      world.incompleteSnapshot = snapshotBefore;
      expect(incompleteChangesNothing.check(world)).toEqual([]);
      world.incompleteSnapshot = null;
      expect(world.store.listRoundStatus()[0]?.lastError).toContain("timeout");
      expect((await pumpRound(world)).ok).toBe(true);
      expect(groundTruth.check(world)).toEqual([]);
    } finally {
      world.dispose();
    }
  }, 120000);
});
