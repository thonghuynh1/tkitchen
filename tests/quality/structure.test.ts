import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspect } from "../../scripts/check-module-structure.mjs";

const LIB = "modules/rounds/lib/x.ts";

describe("env rule", () => {
  it("Date.now in a lib fails naming the Clock port", () => {
    const errors = inspect({ [LIB]: "export const t = Date.now();\n" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Clock");
  });
  it("Date.now in an adapter passes", () => {
    expect(inspect({ "modules/platform/lib/adapters/env.ts": "export const t = Date.now();\n" })).toHaveLength(0);
  });
  it("Math.random in a lib fails", () => {
    expect(inspect({ [LIB]: "export const t = Math.random();\n" })).toHaveLength(1);
  });
  it("checks every env pattern outside adapters", () => {
    const samples = ["export const a = Date.now();", "export const b = new Date();", "export const c = setTimeout(() => undefined, 1);", "export const d = setInterval(() => undefined, 1);", "export const e = Math.random();", "export const f = randomUUID();"];
    for (const sample of samples) {
      const errors = inspect({ [LIB]: sample + "\n" });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("use the Clock/Scheduler/Random/Ids port");
    }
  });
  it("a module's own tests are not production code", () => {
    expect(inspect({ "modules/lock/tests/x.test.ts": "export const t = Date.now();\n" })).toHaveLength(0);
  });
  it("new Date with arguments passes", () => {
    expect(inspect({ [LIB]: "export const t = new Date(0);\n" })).toHaveLength(0);
  });
});
describe("structure CLI", () => {
  it("CLI rejects a clock call in a lib", () => {
    const root = mkdtempSync(join(tmpdir(), "tkitchen-structure-"));
    try {
      mkdirSync(join(root, "scripts"), { recursive: true });
      mkdirSync(join(root, "modules", "rounds", "lib"), { recursive: true });
      copyFileSync(join(process.cwd(), "scripts", "check-module-structure.mjs"), join(root, "scripts", "check-module-structure.mjs"));
      writeFileSync(join(root, "modules", "rounds", "lib", "x.ts"), "export const t = Date.now();\n");
      let status = 0;
      let output = "";
      try {
        output = execFileSync("node", [join(root, "scripts", "check-module-structure.mjs")], { encoding: "utf8" });
      } catch (e) {
        const err = e as { status?: unknown; stdout?: unknown; stderr?: unknown };
        status = typeof err.status === "number" ? err.status : 0;
        output = String(err.stdout ?? "") + String(err.stderr ?? "");
      }
      expect(status).toBe(1);
      expect(output).toContain("use the Clock/Scheduler/Random/Ids port");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
describe("module budget", () => {
  it("801 lines fails", () => {
    expect(inspect({ [LIB]: Array(801).fill("export const x = 1;").join("\n") + "\n" })).toHaveLength(1);
  });
  it("800 lines passes", () => {
    expect(inspect({ [LIB]: Array(800).fill("export const x = 1;").join("\n") + "\n" })).toHaveLength(0);
  });
});
