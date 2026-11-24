import type { Oracle, Violation } from "./oracle.ts";
import type { SimWorld } from "../world/world.ts";

export const exportExactlyOnce: Oracle = {
  id: "export-exactly-once",
  kind: "safety",
  check(world: SimWorld): Violation[] {
    const violations: Violation[] = [];
    world.exportGenerations.forEach((gen, index) => {
      const seen = new Set<string>();
      for (const id of gen.ids) {
        if (seen.has(id)) violations.push({ oracle: "export-exactly-once", kind: "safety", detail: "generation " + (index + 1) + " exported id twice: " + id });
        seen.add(id);
      }
      for (let i = 1; i < gen.seqs.length; i++) {
        const prev = gen.seqs[i - 1] ?? 0;
        const cur = gen.seqs[i] ?? 0;
        if (cur <= prev) violations.push({ oracle: "export-exactly-once", kind: "safety", detail: "generation " + (index + 1) + " seq not strictly increasing: " + prev + " then " + cur });
      }
      const exported = new Set(gen.ids);
      const stored = new Set(gen.storeIds);
      for (const id of stored) if (!exported.has(id)) violations.push({ oracle: "export-exactly-once", kind: "safety", detail: "generation " + (index + 1) + " lost id: " + id });
      for (const id of exported) if (!stored.has(id)) violations.push({ oracle: "export-exactly-once", kind: "safety", detail: "generation " + (index + 1) + " exported id not in store: " + id });
    });
    return violations;
  },
};
