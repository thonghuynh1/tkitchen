import { describe, it, expect } from "vitest";
import { defaultGitRunner } from "../../src/modules/git/adapters.ts";
import { runRounds } from "../../src/modules/rounds/index.ts";
import { SimRemote } from "./doubles/sim-remote.ts";
import { groundTruth } from "./oracles/ground-truth.ts";
import { SimWorld } from "./world/world.ts";
import { formatSeedFailure, runBatch, runSeed, seedsFromEnv } from "./runner/loop.ts";

describe("round sweep", () => {
  it("sweep passes on the real Round", async () => {
    const batch = await runBatch(seedsFromEnv());
    process.stdout.write(batch.summary + "\n");
    const failing = batch.results.find((r) => r.violations.length > 0);
    expect(batch.violations, failing === undefined ? batch.summary : formatSeedFailure(failing)).toEqual([]);
    expect(batch.summary).toContain("realGitCalls=0");
    expect(batch.results.reduce((sum, r) => sum + r.exportResets, 0)).toBeGreaterThan(0);
    expect(batch.results.reduce((sum, r) => sum + r.exportGenerations, 0)).toBeGreaterThan(batch.results.length);
  }, 300000);

  it("mutant: skip child-move recheck is caught", async () => {
    const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
    const batch = await runBatch(seeds, { roundOptions: { skipChildMoveRecheck: true } });
    const failing = batch.results.find((r) => r.violations.some((v) => v.oracle === "ground-truth"));
    expect(failing, "expected a seed to fail ground-truth").toBeDefined();
    if (failing !== undefined) expect(formatSeedFailure(failing)).toContain("seed=");
  }, 300000);

  it("mutant: write inside collect is caught", async () => {
    const seeds = Array.from({ length: 5 }, (_, i) => i + 1);
    const batch = await runBatch(seeds, { roundOptions: { writeInsideCollect: true } });
    const failing = batch.results.find((r) => r.violations.some((v) => v.oracle === "no-tx-across-port"));
    expect(failing, "expected a seed to fail no-tx-across-port").toBeDefined();
    if (failing !== undefined) expect(formatSeedFailure(failing)).toContain("seed=");
  }, 300000);

  it("interleaving: actor runs between port calls in a Round", async () => {
    const batch = await runBatch([1, 2, 3, 4, 5]);
    let interleaved = 0;
    for (const result of batch.results) {
      let inRound = false;
      for (const entry of result.trace) {
        if (entry.event === "git.lsRemoteHeads") inRound = true;
        if (entry.event === "round") inRound = false;
        if (inRound && entry.event.startsWith("actor.")) interleaved += 1;
      }
    }
    expect(interleaved).toBeGreaterThan(0);
    const replay = await runSeed(1);
    expect(replay.traceHash).toBe(batch.results[0]?.traceHash);
  }, 300000);

  it("real git guard blocks a leak from the sim port path and counts it", async () => {
    const original = SimRemote.prototype.lsRemoteHeads;
    let attempted = 0;
    SimRemote.prototype.lsRemoteHeads = async function (remote: string) {
      if (attempted === 0) {
        attempted += 1;
        await expect(defaultGitRunner(["--version"], process.cwd())).rejects.toThrow("real git blocked");
      }
      return original.call(this, remote);
    };
    try {
      const result = await runSeed(7);
      expect(result.realGitCalls).toBe(attempted);
      expect(result.realGitCalls).toBe(1);
      expect(result.violations.some((v) => v.oracle === "real-git-in-sim")).toBe(true);
    } finally {
      SimRemote.prototype.lsRemoteHeads = original;
    }
  }, 120000);

  it("mutant: missing fetch is caught", async () => {
    const world = new SimWorld(7);
    try {
      world.remote.createBranch("feature", "main");
      world.remote.commitOn("feature");
      world.config.setBase("feature", "main");
      const pumpRound = async (): Promise<void> => {
        let settled = false;
        const promise = runRounds({ config: world.config, store: world.store, clock: world.clock, machine: "sim", makeGit: () => world.remote, forge: world.forge })
          .then((r) => { settled = true; return r; }, (e: unknown) => { settled = true; throw e; });
        while (!settled) {
          if (world.clock.pendingCount() > 0) world.clock.pumpOne();
          await new Promise<void>((resolve) => { setImmediate(resolve); });
        }
        await promise;
      };
      await pumpRound();
      expect(groundTruth.check(world)).toEqual([]);
      world.remote.commitOn("main");
      world.remote.fetch = () => Promise.resolve();
      await pumpRound();
      const state = world.store.listBranchStates().find((s) => s.branch === "feature");
      expect(state?.behindBy).toBe(0);
      expect(groundTruth.check(world).some((v) => v.oracle === "ground-truth")).toBe(true);
    } finally {
      world.dispose();
    }
  }, 120000);

  it("mutant: advance heads on forge failure is caught", async () => {
    const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
    const batch = await runBatch(seeds, { roundOptions: { ignoreForgeFailure: true } });
    const failing = batch.results.find((r) => r.violations.some((v) => v.oracle === "incomplete-changes-nothing"));
    expect(failing, "expected a seed to fail incomplete-changes-nothing").toBeDefined();
    if (failing !== undefined) expect(formatSeedFailure(failing)).toContain("seed=");
  }, 300000);

  it("replays one seed from SIM_SEED", async () => {
    const single = await runSeed(7);
    expect(single.seed).toBe(7);
    expect(single.violations).toEqual([]);
  }, 120000);
});
