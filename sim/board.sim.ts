import { describe, expect, it } from "vitest";
import {
  boardSeedsFromEnv,
  formatBoardSeedFailure,
  runBoardBatch,
  runBoardSeed,
  writeBoardTraceJsonl,
} from "./runner/board-runner.ts";

describe("board DST", () => {
  it("board DST sweep holds INV-001..INV-004 and PRG-001 across fault schedules", async () => {
    const seeds = boardSeedsFromEnv();
    const batch = await runBoardBatch(seeds);

    const traceOut = process.env["DST_TRACE_OUT"];
    const firstRun = batch.runs[0];
    if (traceOut !== undefined && traceOut.trim() !== "" && firstRun !== undefined) {
      writeBoardTraceJsonl(traceOut.trim(), firstRun.trace);
    }

    const totalSteps = batch.runs.reduce((sum, run) => sum + run.stepCount, 0);
    process.stdout.write(
      "board DST: seeds=" +
        String(seeds.length) +
        " steps=" +
        String(totalSteps) +
        " violations=" +
        String(batch.violations.length) +
        " coverage=" +
        JSON.stringify(batch.coverage) +
        "\n",
    );

    const failedRuns = batch.runs.filter((run) => run.violations.length > 0);
    expect(batch.violations, failedRuns.map(formatBoardSeedFailure).join("\n")).toEqual([]);

    if (seeds.length >= 20) {
      expect(batch.coverage.sseDropCatchUp).toBeGreaterThan(0);
      expect(batch.coverage.duplicateAndConcurrentRedeem).toBeGreaterThan(0);
      expect(batch.coverage.removeVsPost).toBeGreaterThan(0);
      expect(batch.coverage.closeSharingVsStaleRedeem).toBeGreaterThan(0);
      expect(batch.coverage.archiveWithMultipleStreams).toBeGreaterThan(0);
      expect(batch.coverage.serverRestartCatchUp).toBeGreaterThan(0);
      expect(batch.coverage.serverRestartRevokedInvite).toBeGreaterThan(0);
    }
  });

  it("single-seed replay is deterministic", async () => {
    const first = await runBoardSeed(42);
    const second = await runBoardSeed(42);
    expect(second.stepCount).toBe(first.stepCount);
    expect(second.finalState).toEqual(first.finalState);
    expect(second.traceHash).toBe(first.traceHash);
  });
});
