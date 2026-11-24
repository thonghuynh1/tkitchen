import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspect } from "../../scripts/check-module-structure.mjs";

describe("layer rule", () => {
  it("domain importing infrastructure fails", () => {
    const errors = inspect({ "src/domain/x.ts": "import { a } from \"../infrastructure/y.ts\";\nexport { a };\n" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("src/domain stays pure");
  });
  it("application importing infrastructure fails", () => {
    const errors = inspect({ "src/application/x.ts": "import { a } from \"../infrastructure/y.ts\";\nexport { a };\n" });
    expect(errors).toHaveLength(1);
  });
  it("infrastructure importing domain passes", () => {
    const errors = inspect({ "src/infrastructure/x.ts": "import { a } from \"../domain/y.ts\";\nexport { a };\n" });
    expect(errors).toHaveLength(0);
  });
  it("compact domain import fails", () => {
    const errors = inspect({ "src/domain/x.ts": "import{a}from\"../infrastructure/y.ts\";\nexport { a };\n" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("src/domain stays pure");
  });
  it("compact application import fails", () => {
    expect(inspect({ "src/application/x.ts": "import{a}from\"../cli/y.ts\";\nexport { a };\n" })).toHaveLength(1);
    expect(inspect({ "src/application/x.ts": "import{a}from\"../infrastructure/y.ts\";\nexport { a };\n" })).toHaveLength(1);
  });
  it("compact domain re-export fails", () => {
    const errors = inspect({ "src/domain/x.ts": "export{a}from\"../infrastructure/y.ts\";\n" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("src/domain stays pure");
  });
  it("compact side-effect import and re-export syntax is recognized", () => {
    expect(inspect({ "src/domain/x.ts": "import\"../infrastructure/y.ts\";\n" })).toHaveLength(1);
    expect(inspect({ "src/infrastructure/x.ts": "import{a}from\"../domain/y.ts\";\nexport{a};\n" })).toHaveLength(0);
  });
  it("domain importing domain passes", () => {
    const errors = inspect({ "src/domain/x.ts": "import { a } from \"./y.ts\";\nexport { a };\n" });
    expect(errors).toHaveLength(0);
  });
});
describe("env rule", () => {
  it("Date.now in application fails naming the Clock port", () => {
    const errors = inspect({ "src/application/x.ts": "export const t = Date.now();\n" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Clock");
  });
  it("Date.now in infrastructure env passes", () => {
    const errors = inspect({ "src/infrastructure/env.ts": "export const t = Date.now();\n" });
    expect(errors).toHaveLength(0);
  });
  it("Math.random in domain fails", () => {
    const errors = inspect({ "src/domain/x.ts": "export const t = Math.random();\n" });
    expect(errors).toHaveLength(1);
  });
  it("checks every env pattern outside infrastructure", () => {
    const samples = ["export const a = Date.now();", "export const b = new Date();", "export const c = setTimeout(() => undefined, 1);", "export const d = setInterval(() => undefined, 1);", "export const e = Math.random();", "export const f = randomUUID();"];
    for (const sample of samples) {
      const errors = inspect({ "src/application/x.ts": sample + "\n" });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("use the Clock/Scheduler/Random/Ids port");
    }
  });
  it("new Date with arguments passes", () => {
    const errors = inspect({ "src/application/x.ts": "export const t = new Date(0);\n" });
    expect(errors).toHaveLength(0);
  });
});
describe("structure CLI", () => {
  it("CLI rejects a compact cross-layer import", () => {
    const root = mkdtempSync(join(tmpdir(), "tkitchen-structure-"));
    try {
      mkdirSync(join(root, "scripts"), { recursive: true });
      mkdirSync(join(root, "src", "domain"), { recursive: true });
      mkdirSync(join(root, "src", "infrastructure"), { recursive: true });
      copyFileSync(join(process.cwd(), "scripts", "check-module-structure.mjs"), join(root, "scripts", "check-module-structure.mjs"));
      writeFileSync(join(root, "src", "domain", "x.ts"), "import{a}from\"../infrastructure/y.ts\"; export{a};\n");
      writeFileSync(join(root, "src", "infrastructure", "y.ts"), "export const a = 1;\n");
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
      expect(output).toContain("src/domain stays pure");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
describe("module budget", () => {
  it("801 lines fails", () => {
    const errors = inspect({ "src/domain/x.ts": Array(801).fill("export const x = 1;").join("\n") + "\n" });
    expect(errors).toHaveLength(1);
  });
  it("800 lines passes", () => {
    const errors = inspect({ "src/domain/x.ts": Array(800).fill("export const x = 1;").join("\n") + "\n" });
    expect(errors).toHaveLength(0);
  });
});
