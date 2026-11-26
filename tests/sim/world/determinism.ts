import type { Trace } from "./trace.ts";

export interface DeterminismResult {
  deterministic: boolean;
  hashes: [string, string];
}

export async function checkDeterminism(run: () => Promise<string>): Promise<DeterminismResult> {
  const first = await run();
  const second = await run();
  return { deterministic: first === second, hashes: [first, second] };
}

export function traceHashOf(trace: Trace): string {
  return trace.hash();
}
