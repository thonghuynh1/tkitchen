import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KitchenStore } from "../../src/modules/triggers/lib/adapters/store.ts";
import { baseMovedTrigger } from "../../src/modules/triggers/lib/trigger.ts";

describe("sqlite store", () => {
  it("migrates once and dedupes triggers with monotonic seq", () => {
    const path = join(mkdtempSync(join(tmpdir(), "tk-store-")), "kitchen.db");
    const s1 = new KitchenStore(path);
    expect(s1.userVersion()).toBe(1);
    expect(s1.tableNames()).toEqual(expect.arrayContaining(["event", "disposition", "repo_heads", "branch_state", "round_status"]));
    const t1 = baseMovedTrigger({ repo: "x", base: "C", oldHead: "0".repeat(40), newHead: "a".repeat(40), children: ["B"], at: "2026-01-01T00:00:00.000Z", machine: "m" });
    const t2 = baseMovedTrigger({ repo: "x", base: "C", oldHead: "a".repeat(40), newHead: "b".repeat(40), children: ["B"], at: "2026-01-01T00:01:00.000Z", machine: "m" });
    s1.insertEvent(t1); s1.insertEvent(t1); s1.insertEvent(t2);
    expect(s1.countRows("event")).toBe(2);
    const seqs = s1.listEvents().map((r) => r["seq"]);
    expect(seqs).toEqual([1, 2]);
    s1.close();
    const s2 = new KitchenStore(path);
    expect(s2.userVersion()).toBe(1);
    expect(s2.countRows("event")).toBe(2);
    s2.close();
  });
});
