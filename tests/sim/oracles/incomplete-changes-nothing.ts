import type { Oracle, Violation } from "./oracle.ts";
import type { SimWorld } from "../world/world.ts";

export const incompleteChangesNothing: Oracle = {
  id: "incomplete-changes-nothing",
  kind: "safety",
  check(world: SimWorld): Violation[] {
    if (world.incompleteSnapshot === null) return [];
    if (world.snapshotStore() === world.incompleteSnapshot) return [];
    return [{ oracle: "incomplete-changes-nothing", kind: "safety", detail: "incomplete Round changed event, disposition, branch_state, or repo_heads" }];
  },
};
