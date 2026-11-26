import type { Oracle, Violation } from "./oracle.ts";
import type { SimWorld } from "../world/world.ts";

export const noDuplicates: Oracle = {
  id: "no-duplicates",
  kind: "safety",
  check(world: SimWorld): Violation[] {
    const delta = world.quietDelta;
    if (delta === null) return [];
    const violations: Violation[] = [];
    if (delta.events !== 0)
      violations.push({
        oracle: "no-duplicates",
        kind: "safety",
        detail: "quiet re-run added " + delta.events + " event rows",
      });
    if (delta.dispositions !== 0)
      violations.push({
        oracle: "no-duplicates",
        kind: "safety",
        detail: "quiet re-run added " + delta.dispositions + " disposition rows",
      });
    return violations;
  },
};
