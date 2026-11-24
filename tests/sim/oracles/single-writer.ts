import type { Violation } from "./oracle.ts";
import type { SimLockSystem } from "../doubles/sim-lock.ts";

export const singleWriter = {
  id: "single-writer",
  kind: "safety" as const,
  checkSystem(system: SimLockSystem): Violation[] {
    if (system.maxActiveWriters <= 1) return [];
    return [{ oracle: "single-writer", kind: "safety" as const, detail: "lock held by " + system.maxActiveWriters + " live writers at once" }];
  },
};
