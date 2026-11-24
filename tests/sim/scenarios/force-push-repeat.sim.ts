import { describe, it, expect } from "vitest";
import { groundTruth } from "../oracles/ground-truth.ts";
import { progress } from "../oracles/progress.ts";
import { SimWorld } from "../world/world.ts";
import { pumpRound } from "./run-round.ts";

describe("pinned scenario: force-push repeat (fixed seed 6101)", () => {
  it("C X->Y->X->Y dedupes the second Y and branch_state stays correct", async () => {
    const world = new SimWorld(6101);
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
      const x = world.remote.head("C");
      expect(x).toBeDefined();
      expect((await pumpRound(world)).ok).toBe(true);
      world.remote.commitOn("C");
      const y = world.remote.head("C");
      expect(y).toBeDefined();
      expect(y).not.toBe(x);
      expect((await pumpRound(world)).ok).toBe(true);
      if (x === undefined || y === undefined) throw new Error("missing heads");
      world.remote.forcePush("C", x);
      expect((await pumpRound(world)).ok).toBe(true);
      world.remote.forcePush("C", y);
      expect((await pumpRound(world)).ok).toBe(true);
      const events = world.store.listTriggers();
      expect(events.map((e) => e.meta.newHead)).toEqual([y, x]);
      expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
      expect(world.store.listDispositions().length).toBeGreaterThan(0);
      expect(groundTruth.check(world)).toEqual([]);
      expect(progress.check(world)).toEqual([]);
      for (const child of ["B", "D"]) {
        const state = world.store.listBranchStates().find((s) => s.branch === child);
        expect(state?.base).toBe("C");
        expect(state?.baseOid).toBe(y);
        expect(state?.behindBy).toBe(world.remote.countBehindOids(state?.headOid ?? "", y));
        expect(state?.status).toBe("behind");
      }
    } finally { world.dispose(); }
  }, 120000);
});
