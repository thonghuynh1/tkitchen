import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspect } from "../../scripts/check-module-structure.mjs";

const LIB = "src/modules/rounds/lib/x.ts";
const ADAPTER = "src/modules/git/lib/adapters/x.ts";

describe("pure lib rule", () => {
  it("lib importing another module's adapters fails", () => {
    const errors = inspect({ [LIB]: "import { a } from \"../../git/lib/adapters/y.ts\";\nexport { a };\n" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("lib stays pure");
  });
  it("lib importing another module's adapters entry fails", () => {
    expect(inspect({ [LIB]: "import { a } from \"../../git/adapters.ts\";\nexport { a };\n" })).toHaveLength(1);
  });
  it("lib importing another module's index passes", () => {
    expect(inspect({ [LIB]: "import { a } from \"../../git/index.ts\";\nexport { a };\n" })).toHaveLength(0);
  });
  it("lib importing its own adapters fails", () => {
    expect(inspect({ [LIB]: "import { a } from \"./adapters/y.ts\";\nexport { a };\n" })).toHaveLength(1);
  });
  it("lib importing the cli fails", () => {
    expect(inspect({ [LIB]: "import { a } from \"../../../cli/y.ts\";\nexport { a };\n" })).toHaveLength(1);
  });
  it("lib importing a Node built-in fails", () => {
    const errors = inspect({ [LIB]: "import { readFile } from \"node:fs/promises\";\nexport { readFile };\n" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("only lib/adapters may import Node built-ins");
  });
  it("lib importing node:crypto for hashing passes", () => {
    expect(inspect({ [LIB]: "import { createHash } from \"node:crypto\";\nexport { createHash };\n" })).toHaveLength(0);
  });
  it("adapters importing lib and Node built-ins pass", () => {
    expect(inspect({ [ADAPTER]: "import { a } from \"../y.ts\";\nimport { spawn } from \"node:child_process\";\nexport { a, spawn };\n" })).toHaveLength(0);
  });
  it("lib importing another module's lib passes", () => {
    expect(inspect({ [LIB]: "import { a } from \"../../branches/lib/y.ts\";\nexport { a };\n" })).toHaveLength(0);
  });
  it("compact import and re-export syntax is recognized", () => {
    expect(inspect({ [LIB]: "import{a}from\"../../git/lib/adapters/y.ts\";\nexport { a };\n" })).toHaveLength(1);
    expect(inspect({ [LIB]: "export{a}from\"../../git/lib/adapters/y.ts\";\n" })).toHaveLength(1);
    expect(inspect({ [LIB]: "import\"../../git/lib/adapters/y.ts\";\n" })).toHaveLength(1);
    expect(inspect({ [ADAPTER]: "import{a}from\"../y.ts\";\nexport{a};\n" })).toHaveLength(0);
  });
});
describe("env rule", () => {
  it("Date.now in a lib fails naming the Clock port", () => {
    const errors = inspect({ [LIB]: "export const t = Date.now();\n" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Clock");
  });
  it("Date.now in an adapter passes", () => {
    expect(inspect({ "src/modules/platform/lib/adapters/env.ts": "export const t = Date.now();\n" })).toHaveLength(0);
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
    expect(inspect({ "src/modules/lock/tests/x.test.ts": "import { a } from \"node:fs\";\nexport const t = Date.now();\nexport { a };\n" })).toHaveLength(0);
  });
  it("new Date with arguments passes", () => {
    expect(inspect({ [LIB]: "export const t = new Date(0);\n" })).toHaveLength(0);
  });
});
describe("structure CLI", () => {
  it("CLI rejects a compact lib-to-adapter import", () => {
    const root = mkdtempSync(join(tmpdir(), "tkitchen-structure-"));
    try {
      mkdirSync(join(root, "scripts"), { recursive: true });
      mkdirSync(join(root, "src", "modules", "rounds", "lib"), { recursive: true });
      mkdirSync(join(root, "src", "modules", "git", "lib", "adapters"), { recursive: true });
      copyFileSync(join(process.cwd(), "scripts", "check-module-structure.mjs"), join(root, "scripts", "check-module-structure.mjs"));
      writeFileSync(join(root, "src", "modules", "rounds", "lib", "x.ts"), "import{a}from\"../../git/lib/adapters/y.ts\"; export{a};\n");
      writeFileSync(join(root, "src", "modules", "git", "lib", "adapters", "y.ts"), "export const a = 1;\n");
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
      expect(output).toContain("lib stays pure");
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
