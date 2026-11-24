import { runRounds } from "../../../src/application/round.ts";
import type { RoundOptions } from "../../../src/application/round.ts";
import { Developer } from "../actors/developer.ts";
import { groundTruth } from "../oracles/ground-truth.ts";
import { incompleteChangesNothing } from "../oracles/incomplete-changes-nothing.ts";
import { noDuplicates } from "../oracles/no-duplicates.ts";
import { noTxAcrossPort } from "../oracles/no-tx-across-port.ts";
import { progress } from "../oracles/progress.ts";
import { GIT_METHODS } from "../faults/git-faults.ts";
import type { Violation } from "../oracles/oracle.ts";
import { formatTrace } from "../world/trace.ts";
import type { TraceEntry } from "../world/trace.ts";
import { SimWorld } from "../world/world.ts";

export interface SeedResult {
  seed: number; violations: Violation[]; traceHash: string;
  trace: readonly TraceEntry[]; realGitCalls: number; rounds: number;
}
export interface SeedOptions { roundOptions?: RoundOptions; }

const ROUND_EVERY_STEPS = 3;
const ROUND_ADVANCE_MS = 15 * 60 * 1000;
const MIN_BRANCHES = 3;
const BRANCH_SPAN = 6;
const MIN_STEPS = 20;
const STEP_SPAN = 41;
const TRACE_TAIL = 20;
const INTERLEAVE_CHANCE = 0.1;
const MAX_PUMP_SPINS = 1000000;

export async function runSeed(seed: number, options: SeedOptions = {}): Promise<SeedResult> {
  const world = new SimWorld(seed);
  const violations: Violation[] = [];
  let rounds = 0;
  try {
    const developer = new Developer({ rng: world.rng, remote: world.remote, forge: world.forge, config: world.config, trace: world.trace, clock: world.clock });
    developer.createInitialTree(MIN_BRANCHES + world.rng.nextInt(BRANCH_SPAN));
    const doRound = async (interleave = true, allowFaults = true): Promise<void> => {
      world.clock.advance(ROUND_ADVANCE_MS);
      const snapshotBefore = world.snapshotStore();
      if (allowFaults && !world.forge.failNextArmed && world.rng.next() < 0.15) { world.forge.failNext(); world.trace.record(world.clock.nowMs(), "actor.forge-fail", "next forge call fails"); }
      world.forgeFaultPending = world.forge.failNextArmed;
      if (allowFaults && !world.remote.gitFaultArmed && world.rng.next() < 0.15) {
        const method = GIT_METHODS[world.rng.nextInt(GIT_METHODS.length)] ?? "lsRemoteHeads";
        const kind = world.rng.next() < 0.5 ? "timeout" : "failed";
        world.remote.failNextGit(method, kind);
        world.trace.record(world.clock.nowMs(), "actor.git-fault", method + " " + kind);
      }
      world.gitFaultPending = world.remote.gitFaultArmed;
      let settled = false;
      const roundPromise = runRounds({ config: world.config, store: world.store, clock: world.clock, machine: "sim", makeGit: () => world.remote, forge: world.forge, options: options.roundOptions }, undefined)
        .then((r) => { settled = true; return r; }, (e: unknown) => { settled = true; throw e; });
      let spins = 0;
      while (!settled) {
        spins += 1;
        if (spins > MAX_PUMP_SPINS) throw new Error("sim scheduler pump did not settle");
        if (world.clock.pendingCount() > 0) {
          const safeToDelete = world.currentPortMethod !== "lsRemoteHeads" && world.currentPortMethod !== "fetch";
          if (interleave && world.currentPortMethod !== "fetch" && world.currentPortMethod !== "listOpenPullRequests" && world.rng.next() < INTERLEAVE_CHANCE) developer.act(safeToDelete);
          world.clock.pumpOne();
          await Promise.resolve();
        } else {
          await new Promise<void>((resolve) => { setImmediate(resolve); });
        }
      }
      const result = await roundPromise;
      rounds += 1;
      world.trace.record(world.clock.nowMs(), "round", result.ok ? "ok" : "failed");
      const forgeFaultArmed = world.forgeFaultPending && !world.forge.failNextArmed;
      const gitFaultConsumed = world.gitFaultPending && !world.remote.gitFaultArmed;
      const faultArmed = forgeFaultArmed || gitFaultConsumed;
      world.forgeFaultPending = world.forge.failNextArmed;
      world.gitFaultPending = world.remote.gitFaultArmed;
      if (faultArmed || !result.ok) {
        world.incompleteSnapshot = snapshotBefore;
        violations.push(...incompleteChangesNothing.check(world));
        world.incompleteSnapshot = null;
        if (!faultArmed && !result.ok) violations.push({ oracle: "ground-truth", kind: "safety", detail: "round reported failure without a seeded fault: " + (world.store.listRoundStatus()[0]?.lastError ?? "unknown") });
        if (forgeFaultArmed && gitFaultConsumed && result.ok) violations.push({ oracle: "incomplete-changes-nothing", kind: "safety", detail: "round reported success despite a seeded fault" });
        if (forgeFaultArmed && !gitFaultConsumed && result.ok && options.roundOptions?.ignoreForgeFailure !== true) violations.push({ oracle: "incomplete-changes-nothing", kind: "safety", detail: "round reported success despite a seeded forge fault" });
        if (!forgeFaultArmed && gitFaultConsumed && result.ok) violations.push({ oracle: "incomplete-changes-nothing", kind: "safety", detail: "round reported success despite a seeded git fault" });
      }
      if (result.ok && !faultArmed) violations.push(...groundTruth.check(world));
      if (result.ok && faultArmed && options.roundOptions?.ignoreForgeFailure === true) violations.push(...groundTruth.check(world));
    };
    await doRound();
    const steps = MIN_STEPS + world.rng.nextInt(STEP_SPAN);
    for (let step = 0; step < steps; step++) {
      developer.act();
      if ((step + 1) % ROUND_EVERY_STEPS === 0) await doRound();
    }
    world.remote.clearGitFaults();
    world.forge.clearFaults();
    world.gitFaultPending = false;
    world.forgeFaultPending = false;
    await doRound(false, false);
    violations.push(...progress.check(world));
    const eventsBefore = world.store.eventCount();
    const dispositionsBefore = world.store.dispositionCount();
    await doRound(false, false);
    world.quietDelta = { events: world.store.eventCount() - eventsBefore, dispositions: world.store.dispositionCount() - dispositionsBefore };
    violations.push(...noDuplicates.check(world));
    violations.push(...noTxAcrossPort.check(world));
    if (world.realGitCalls > 0) violations.push({ oracle: "real-git-in-sim", kind: "safety", detail: "real git executed " + world.realGitCalls + " time(s) inside a sim" });
    return { seed, violations, traceHash: world.trace.hash(), trace: [...world.trace.all()], realGitCalls: world.realGitCalls, rounds };
  } finally {
    world.dispose();
  }
}

export function formatSeedFailure(result: SeedResult): string {
  const first = result.violations[0];
  const oracle = first === undefined ? "none" : first.oracle;
  const lines = ["seed=" + result.seed + " oracle=" + oracle];
  for (const violation of result.violations) lines.push("violation oracle=" + violation.oracle + " " + violation.detail);
  lines.push(formatTrace(result.trace.slice(Math.max(0, result.trace.length - TRACE_TAIL))));
  return lines.join("\n");
}

export interface BatchResult { results: SeedResult[]; violations: Violation[]; summary: string; }

export async function runBatch(seeds: number[], options: SeedOptions = {}): Promise<BatchResult> {
  const results: SeedResult[] = [];
  for (const seed of seeds) results.push(await runSeed(seed, options));
  const violations = results.flatMap((r) => r.violations);
  const realGitCalls = results.reduce((sum, r) => sum + r.realGitCalls, 0);
  return { results, violations, summary: "round seeds=" + results.length + " violations=" + violations.length + " realGitCalls=" + realGitCalls };
}

export function seedsFromEnv(): number[] {
  const single = process.env["SIM_SEED"];
  if (single !== undefined && single !== "") return [Number.parseInt(single, 10)];
  const countRaw = process.env["SIM_SEEDS"];
  const count = countRaw === undefined || countRaw === "" ? 200 : Number.parseInt(countRaw, 10);
  return Array.from({ length: count }, (_, i) => i + 1);
}
