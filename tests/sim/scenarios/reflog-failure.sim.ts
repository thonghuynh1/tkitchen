import { describe, it, expect } from "vitest";
import { GitRepoImpl } from "../../../modules/git/adapters.ts";
import { incompleteChangesNothing } from "../oracles/incomplete-changes-nothing.ts";
import { SimWorld } from "../world/world.ts";
import { pumpRound } from "./run-round.ts";

const failingAdapter = new GitRepoImpl("unused", async () => ({
  stdout: "",
  stderr: "fatal: unable to read reflog: Permission denied",
  code: 128,
}));

describe("pinned scenario: fatal reflog failure makes the Round incomplete (fixed seed 6105)", () => {
  it("creationReflog exit 128 changes nothing and records last_error", async () => {
    const world = new SimWorld(6105);
    try {
      world.remote.createBranch("feature", "main");
      world.remote.commitOn("feature");
      expect((await pumpRound(world)).ok).toBe(true);
      const snapshotBefore = world.snapshotStore();
      world.remote.commitOn("main");
      world.remote.creationReflog = (branch) => failingAdapter.creationReflog(branch);
      expect((await pumpRound(world)).ok).toBe(false);
      world.incompleteSnapshot = snapshotBefore;
      expect(incompleteChangesNothing.check(world)).toEqual([]);
      world.incompleteSnapshot = null;
      expect(world.store.listRoundStatus()[0]?.lastError).toContain("reflog");
      const state = world.store.listBranchStates().find((s) => s.branch === "feature");
      expect(state?.base).toBe("main");
      expect(state?.status).toBe("up_to_date");
    } finally {
      world.dispose();
    }
  }, 120000);

  it("tipAt exit 128 changes nothing and records last_error", async () => {
    const world = new SimWorld(6106);
    try {
      const mainHead = world.remote.head("main");
      if (mainHead === undefined) throw new Error("missing main");
      world.remote.createBranchFromCommit("feature", mainHead);
      world.remote.commitOn("feature");
      expect((await pumpRound(world)).ok).toBe(true);
      const snapshotBefore = world.snapshotStore();
      world.remote.commitOn("main");
      world.remote.tipAt = (ref, at) => failingAdapter.tipAt(ref, at);
      expect((await pumpRound(world)).ok).toBe(false);
      world.incompleteSnapshot = snapshotBefore;
      expect(incompleteChangesNothing.check(world)).toEqual([]);
      world.incompleteSnapshot = null;
      expect(world.store.listRoundStatus()[0]?.lastError).toContain("reflog");
    } finally {
      world.dispose();
    }
  }, 120000);
});
