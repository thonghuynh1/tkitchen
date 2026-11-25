import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { triggerId } from "../../src/modules/triggers/lib/trigger.ts";

describe("trigger id", () => {
  it("matches the sha256 recipe", () => {
    const head = "a".repeat(40);
    const expected = createHash("sha256").update("git-base\0x\0C\0" + head, "utf8").digest("hex");
    expect(triggerId("x", "C", head)).toBe(expected);
    expect(triggerId("x", "C", "b".repeat(40))).not.toBe(expected);
  });
});
