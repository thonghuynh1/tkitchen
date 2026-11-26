import { describe, it, expect } from "vitest";
import type { Config, KitchenConfig, RepoConfig } from "../modules/config/index.ts";
import type { GitRepo } from "../modules/git/index.ts";
import type { Scheduler } from "../modules/platform/index.ts";
import { serve } from "../modules/rounds/index.ts";
import type { ServeResult } from "../modules/rounds/index.ts";
import { SimWorld } from "./world/world.ts";
import { SimLock, SimLockSystem } from "./doubles/sim-lock.ts";
import { CrashError, CrashInjector } from "./faults/crash.ts";
import { pumpRound } from "./scenarios/run-round.ts";
import { groundTruth } from "./oracles/ground-truth.ts";
import { incompleteChangesNothing } from "./oracles/incomplete-changes-nothing.ts";
import { progress } from "./oracles/progress.ts";
import { singleWriter } from "./oracles/single-writer.ts";

const MAX_PUMP_SPINS = 1000000;
const ROUND_MINUTES = 15;
const MINUTE_MS = 60_000;

class MultiRepoConfig implements Config {
  private readonly config: KitchenConfig;
  constructor(repos: RepoConfig[]) {
    this.config = { repos, roundMinutes: ROUND_MINUTES };
  }
  load(): Promise<KitchenConfig> {
    return Promise.resolve(this.config);
  }
}

async function drive(world: SimWorld, promise: Promise<ServeResult>): Promise<ServeResult> {
  let settled = false;
  let outcome: ServeResult | null = null;
  let failure: unknown = null;
  let hasFailure = false;
  const tracked = promise.then(
    (r) => {
      settled = true;
      outcome = r;
    },
    (e: unknown) => {
      settled = true;
      failure = e;
      hasFailure = true;
    },
  );
  let spins = 0;
  while (!settled) {
    spins += 1;
    if (spins > MAX_PUMP_SPINS) throw new Error("serve pump did not settle");
    if (world.clock.pendingCount() > 0) {
      world.clock.pumpOne();
      await Promise.resolve();
    } else {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
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
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
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
      const repos: RepoConfig[] = ["alpha", "beta", "gamma"].map((name) => ({
        name,
        path: "sim",
        remote: "origin",
        forge: "github",
        bases: {},
      }));
      const sleeps: number[] = [];
      const scheduler: Scheduler = {
        sleep(ms: number): Promise<void> {
          sleeps.push(ms);
          return world.clock.sleep(ms);
        },
      };
      const system = new SimLockSystem();
      let cycles = 0;
      let stop = false;
      const result = await drive(
        world,
        serve({
          config: new MultiRepoConfig(repos),
          store: world.store,
          clock: world.clock,
          machine: "sim",
          makeGit: (repo: RepoConfig): GitRepo => {
            world.trace.record(world.clock.nowMs(), "serve.round", repo.name);
            return world.remote;
          },
          forge: world.forge,
          scheduler,
          lock: new SimLock(system, 7101),
          shouldStop: () => stop,
          onCycle: () => {
            cycles += 1;
            if (cycles === 2) stop = true;
          },
        }),
      );
      expect(result.kind).toBe("stopped");
      const rounds = world.trace
        .all()
        .filter((e) => e.event === "serve.round")
        .map((e) => e.outcome);
      expect(rounds).toEqual(["alpha", "beta", "gamma", "alpha", "beta", "gamma"]);
      expect(sleeps).toEqual([ROUND_MINUTES * MINUTE_MS]);
      expect(system.holderPid()).toBeNull();
      expect(singleWriter.checkSystem(system)).toEqual([]);
    } finally {
      world.dispose();
    }
  }, 120000);

  it("second serve is refused while one runs", async () => {
    const world = new SimWorld(7002);
    try {
      seedWorld(world);
      const system = new SimLockSystem();
      let cycles = 0;
      let stop = false;
      const first = serve({
        config: world.config,
        store: world.store,
        clock: world.clock,
        machine: "sim",
        makeGit: () => world.remote,
        forge: world.forge,
        scheduler: world.clock,
        lock: new SimLock(system, 7201),
        shouldStop: () => stop,
        onCycle: () => {
          cycles += 1;
        },
      });
      await driveUntil(world, () => cycles === 1);
      const second = await serve({
        config: world.config,
        store: world.store,
        clock: world.clock,
        machine: "sim",
        makeGit: () => world.remote,
        forge: world.forge,
        scheduler: world.clock,
        lock: new SimLock(system, 7202),
      });
      expect(second).toEqual({ kind: "held", pid: 7201 });
      expect(system.holderPid()).toBe(7201);
      stop = true;
      expect((await drive(world, first)).kind).toBe("stopped");
      expect(system.holderPid()).toBeNull();
      expect(singleWriter.checkSystem(system)).toEqual([]);
    } finally {
      world.dispose();
    }
  }, 120000);

  it("crash at every port boundary and restart keep the store consistent", async () => {
    const measureWorld = new SimWorld(7500);
    let total = 0;
    try {
      seedWorld(measureWorld);
      await pumpRound(measureWorld);
      measureWorld.remote.commitOn("C");
      const counter = new CrashInjector();
      let measureStop = false;
      await drive(
        measureWorld,
        serve({
          config: counter.wrapConfig(measureWorld.config),
          store: counter.wrapStore(measureWorld.store),
          clock: measureWorld.clock,
          machine: "sim",
          makeGit: () => counter.wrapGit(measureWorld.remote),
          forge: counter.wrapForge(measureWorld.forge),
          scheduler: counter.wrapScheduler(measureWorld.clock),
          lock: counter.wrapLock(new SimLock(new SimLockSystem(), 7501)),
          shouldStop: () => measureStop,
          onCycle: () => {
            measureStop = true;
          },
        }),
      );
      total = counter.count;
    } finally {
      measureWorld.dispose();
    }
    expect(total).toBeGreaterThan(10);
    for (let position = 0; position < total; position++) {
      const world = new SimWorld(7600 + position);
      try {
        seedWorld(world);
        await pumpRound(world);
        world.remote.commitOn("C");
        const snapshotBefore = world.snapshotStore();
        const eventsBefore = world.store.listTriggers().length;
        const system = new SimLockSystem();
        const crashedLock = new SimLock(system, 7600 + position);
        const injector = new CrashInjector({
          afterCalls: position,
          onCrash: () => {
            crashedLock.crash();
          },
        });
        const crashed = serve({
          config: injector.wrapConfig(world.config),
          store: injector.wrapStore(world.store),
          clock: world.clock,
          machine: "sim",
          makeGit: () => injector.wrapGit(world.remote),
          forge: injector.wrapForge(world.forge),
          scheduler: injector.wrapScheduler(world.clock),
          lock: injector.wrapLock(crashedLock),
        });
        await expect(drive(world, crashed), "position " + position).rejects.toBeInstanceOf(CrashError);
        const eventsAfterCrash = world.store.listTriggers().length;
        expect([eventsBefore, eventsBefore + 1], "position " + position).toContain(eventsAfterCrash);
        if (eventsAfterCrash === eventsBefore) {
          expect(world.snapshotStore(), "position " + position).toBe(snapshotBefore);
          world.incompleteSnapshot = snapshotBefore;
          expect(incompleteChangesNothing.check(world), "position " + position).toEqual([]);
          world.incompleteSnapshot = null;
        } else {
          expect(groundTruth.check(world), "position " + position).toEqual([]);
        }
        let stop = false;
        const restarted = await drive(
          world,
          serve({
            config: world.config,
            store: world.store,
            clock: world.clock,
            machine: "sim",
            makeGit: () => world.remote,
            forge: world.forge,
            scheduler: world.clock,
            lock: new SimLock(system, 7700 + position),
            shouldStop: () => stop,
            onCycle: () => {
              stop = true;
            },
          }),
        );
        expect(restarted.kind, "position " + position).toBe("stopped");
        expect(system.holderPid(), "position " + position).toBeNull();
        expect(world.store.listTriggers().length, "position " + position).toBe(eventsBefore + 1);
        expect(groundTruth.check(world), "position " + position).toEqual([]);
        expect(progress.check(world), "position " + position).toEqual([]);
        expect(singleWriter.checkSystem(system), "position " + position).toEqual([]);
      } finally {
        world.dispose();
      }
    }
  }, 300000);

  it("crash at the scheduler boundary after a committed Round restarts without duplicates", async () => {
    const world = new SimWorld(7800);
    try {
      seedWorld(world);
      await pumpRound(world);
      world.remote.commitOn("C");
      const system = new SimLockSystem();
      const crashedLock = new SimLock(system, 7801);
      const injector = new CrashInjector({
        crashAtLabel: "scheduler.sleep",
        onCrash: () => {
          crashedLock.crash();
        },
      });
      const crashed = serve({
        config: injector.wrapConfig(world.config),
        store: injector.wrapStore(world.store),
        clock: world.clock,
        machine: "sim",
        makeGit: () => injector.wrapGit(world.remote),
        forge: injector.wrapForge(world.forge),
        scheduler: injector.wrapScheduler(world.clock),
        lock: injector.wrapLock(crashedLock),
      });
      await expect(drive(world, crashed)).rejects.toBeInstanceOf(CrashError);
      expect(world.store.listTriggers()).toHaveLength(1);
      expect(groundTruth.check(world)).toEqual([]);
      let stop = false;
      const restarted = await drive(
        world,
        serve({
          config: world.config,
          store: world.store,
          clock: world.clock,
          machine: "sim",
          makeGit: () => world.remote,
          forge: world.forge,
          scheduler: world.clock,
          lock: new SimLock(system, 7802),
          shouldStop: () => stop,
          onCycle: () => {
            stop = true;
          },
        }),
      );
      expect(restarted.kind).toBe("stopped");
      expect(world.store.listTriggers()).toHaveLength(1);
      expect(world.store.listDispositions()).toHaveLength(1);
      expect(groundTruth.check(world)).toEqual([]);
      expect(progress.check(world)).toEqual([]);
      expect(singleWriter.checkSystem(system)).toEqual([]);
    } finally {
      world.dispose();
    }
  }, 120000);
});
