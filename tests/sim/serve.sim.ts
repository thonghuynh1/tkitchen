import { describe, it, expect } from "vitest";
import type { Config, GitRepo, KitchenConfig, RepoConfig, Scheduler } from "../../src/application/ports.ts";
import { serve } from "../../src/application/serve.ts";
import type { ServeResult } from "../../src/application/serve.ts";
import { SimWorld } from "./world/world.ts";
import { SimLock, SimLockSystem } from "./doubles/sim-lock.ts";
import { CrashError, crashingGit } from "./faults/crash.ts";
import { groundTruth } from "./oracles/ground-truth.ts";
import { incompleteChangesNothing } from "./oracles/incomplete-changes-nothing.ts";
import { progress } from "./oracles/progress.ts";
import { singleWriter } from "./oracles/single-writer.ts";

const MAX_PUMP_SPINS = 1000000;
const ROUND_MINUTES = 15;
const MINUTE_MS = 60_000;

class MultiRepoConfig implements Config {
  private readonly config: KitchenConfig;
  constructor(repos: RepoConfig[]) { this.config = { repos, roundMinutes: ROUND_MINUTES }; }
  load(): Promise<KitchenConfig> { return Promise.resolve(this.config); }
}

async function drive(world: SimWorld, promise: Promise<ServeResult>): Promise<ServeResult> {
  let settled = false;
  let outcome: ServeResult | null = null;
  let failure: unknown = null;
  let hasFailure = false;
  const tracked = promise.then((r) => { settled = true; outcome = r; }, (e: unknown) => { settled = true; failure = e; hasFailure = true; });
  let spins = 0;
  while (!settled) {
    spins += 1;
    if (spins > MAX_PUMP_SPINS) throw new Error("serve pump did not settle");
    if (world.clock.pendingCount() > 0) {
      world.clock.pumpOne();
      await Promise.resolve();
    } else {
      await new Promise<void>((resolve) => { setImmediate(resolve); });
    }
  }
  await tracked;
  if (hasFailure) throw failure;
  if (outcome === null) throw new Error("serve settled without a result");
  return outcome;
}

async function driveUntil(world: SimWorld, condition: () => boolean): Promise<void> {
  let spins = 0;
  while (!condition()) {
    spins += 1;
    if (spins > MAX_PUMP_SPINS) throw new Error("serve pump did not reach condition");
    if (world.clock.pendingCount() > 0) {
      world.clock.pumpOne();
      await Promise.resolve();
    } else {
      await new Promise<void>((resolve) => { setImmediate(resolve); });
    }
  }
}

function seedWorld(world: SimWorld): void {
  world.remote.createBranch("C", "main");
  world.remote.commitOn("C");
  world.remote.createBranch("B", "C");
  world.remote.commitOn("B");
  world.config.setBase("C", "main");
  world.config.setBase("B", "C");
}

describe("serve loop", () => {
  it("two intervals run every repo twice", async () => {
    const world = new SimWorld(7001);
    try {
      seedWorld(world);
      const repos: RepoConfig[] = ["alpha", "beta", "gamma"].map((name) => ({ name, path: "sim", remote: "origin", forge: "github", bases: {} }));
      const sleeps: number[] = [];
      const scheduler: Scheduler = {
        sleep(ms: number): Promise<void> { sleeps.push(ms); return world.clock.sleep(ms); },
      };
      const system = new SimLockSystem();
      let cycles = 0;
      let stop = false;
      const result = await drive(world, serve({
        config: new MultiRepoConfig(repos), store: world.store, clock: world.clock, machine: "sim",
        makeGit: (repo: RepoConfig): GitRepo => { world.trace.record(world.clock.nowMs(), "serve.round", repo.name); return world.remote; },
        forge: world.forge, scheduler, lock: new SimLock(system, 7101),
        shouldStop: () => stop,
        onCycle: () => { cycles += 1; if (cycles === 2) stop = true; },
      }));
      expect(result.kind).toBe("stopped");
      const rounds = world.trace.all().filter((e) => e.event === "serve.round").map((e) => e.outcome);
      expect(rounds).toEqual(["alpha", "beta", "gamma", "alpha", "beta", "gamma"]);
      expect(sleeps).toEqual([ROUND_MINUTES * MINUTE_MS]);
      expect(system.holderPid()).toBeNull();
      expect(singleWriter.checkSystem(system)).toEqual([]);
    } finally { world.dispose(); }
  }, 120000);

  it("second serve is refused while one runs", async () => {
    const world = new SimWorld(7002);
    try {
      seedWorld(world);
      const system = new SimLockSystem();
      let cycles = 0;
      let stop = false;
      const first = serve({
        config: world.config, store: world.store, clock: world.clock, machine: "sim",
        makeGit: () => world.remote, forge: world.forge, scheduler: world.clock, lock: new SimLock(system, 7201),
        shouldStop: () => stop,
        onCycle: () => { cycles += 1; },
      });
      await driveUntil(world, () => cycles === 1);
      const second = await serve({
        config: world.config, store: world.store, clock: world.clock, machine: "sim",
        makeGit: () => world.remote, forge: world.forge, scheduler: world.clock, lock: new SimLock(system, 7202),
      });
      expect(second).toEqual({ kind: "held", pid: 7201 });
      expect(system.holderPid()).toBe(7201);
      stop = true;
      expect((await drive(world, first)).kind).toBe("stopped");
      expect(system.holderPid()).toBeNull();
      expect(singleWriter.checkSystem(system)).toEqual([]);
    } finally { world.dispose(); }
  }, 120000);

  it("crash and restart keep the store consistent across the batch", async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const world = new SimWorld(7300 + seed);
      try {
        seedWorld(world);
        world.remote.commitOn("C");
        const system = new SimLockSystem();
        const crashedLock = new SimLock(system, 7300 + seed);
        const snapshotBefore = world.snapshotStore();
        const afterCalls = seed % 5;
        const crashed = serve({
          config: world.config, store: world.store, clock: world.clock, machine: "sim",
          makeGit: () => crashingGit(world.remote, afterCalls, () => { crashedLock.crash(); }),
          forge: world.forge, scheduler: world.clock, lock: crashedLock,
        });
        await expect(drive(world, crashed)).rejects.toBeInstanceOf(CrashError);
        expect(world.snapshotStore()).toBe(snapshotBefore);
        world.incompleteSnapshot = snapshotBefore;
        expect(incompleteChangesNothing.check(world), "seed " + seed).toEqual([]);
        world.incompleteSnapshot = null;
        expect(system.holderPid(), "seed " + seed).toBe(7300 + seed);
        let stop = false;
        const restarted = await drive(world, serve({
          config: world.config, store: world.store, clock: world.clock, machine: "sim",
          makeGit: () => world.remote, forge: world.forge, scheduler: world.clock,
          lock: new SimLock(system, 7400 + seed),
          shouldStop: () => stop,
          onCycle: () => { stop = true; },
        }));
        expect(restarted.kind, "seed " + seed).toBe("stopped");
        expect(system.holderPid(), "seed " + seed).toBeNull();
        expect(groundTruth.check(world), "seed " + seed).toEqual([]);
        expect(progress.check(world), "seed " + seed).toEqual([]);
        expect(singleWriter.checkSystem(system), "seed " + seed).toEqual([]);
      } finally { world.dispose(); }
    }
  }, 300000);
});
