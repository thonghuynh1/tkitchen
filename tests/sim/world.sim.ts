import { describe, it, expect } from "vitest";
import { defaultGitRunner } from "../../src/infrastructure/git/git-repo.ts";
import { checkDeterminism } from "./world/determinism.ts";
import { SimWorld } from "./world/world.ts";
import { runSeed } from "./runner/loop.ts";
import { Trace } from "./world/trace.ts";

describe("sim world determinism", () => {
  it("same seed, same trace", async () => {
    const first = await runSeed(42);
    const second = await runSeed(42);
    expect(second.traceHash).toBe(first.traceHash);
    const other = await runSeed(43);
    expect(other.traceHash).not.toBe(first.traceHash);
  }, 120000);

  it("sim world installs the real git blocking guard", async () => {
    const world = new SimWorld(99);
    try {
      await expect(defaultGitRunner(["--version"], process.cwd())).rejects.toThrow("real git blocked");
      expect(world.realGitCalls).toBe(1);
    } finally {
      world.dispose();
    }
  });

  it("leak is detected", async () => {
    const runLeaky = async (): Promise<string> => {
      await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
      const trace = new Trace();
      trace.record(0, "leak.commit", "oid-" + Date.now());
      return trace.hash();
    };
    const result = await checkDeterminism(runLeaky);
    expect(result.deterministic).toBe(false);
    expect(result.hashes[0]).not.toBe(result.hashes[1]);
  });
});
