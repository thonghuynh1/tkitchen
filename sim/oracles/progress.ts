import { groundTruth } from "./ground-truth.ts";
import type { Oracle, Violation } from "./oracle.ts";
import type { SimWorld } from "../world/world.ts";

export const progress: Oracle = {
  id: "progress",
  kind: "progress",
  check(world: SimWorld): Violation[] {
    return groundTruth.check(world).map((v): Violation => ({ oracle: "progress", kind: "progress", detail: v.detail }));
  },
};
