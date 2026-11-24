import { execFile } from "node:child_process";
import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const ROOT = process.cwd();
const FIXTURES = join(ROOT, "tests", "quality", "fixtures", "lint");
const OXLINT = join(ROOT, "node_modules", "oxlint", "bin", "oxlint");
const TEST_TIMEOUT = 120000;

async function lintFixture(fixture: string, target: string): Promise<{ code: number; output: string }> {
  const targetPath = join(ROOT, target);
  copyFileSync(join(FIXTURES, fixture), targetPath);
  try {
    try {
      const result = await run("node", [OXLINT, target], { cwd: ROOT });
      return { code: 0, output: result.stdout.toString() + result.stderr.toString() };
    } catch (e) {
      const err = e as { code?: unknown; stdout?: unknown; stderr?: unknown };
      return { code: typeof err.code === "number" ? err.code : 1, output: String(err.stdout ?? "") + String(err.stderr ?? "") };
    }
  } finally {
    if (existsSync(targetPath)) unlinkSync(targetPath);
  }
}

describe("lint fixtures", () => {
  it("floating promise fails lint", async () => {
    const result = await lintFixture("floating-promise.ts.txt", "src/__lint_fixture__.ts");
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("no-floating-promises");
  }, TEST_TIMEOUT);
  it("a comment fails lint", async () => {
    const result = await lintFixture("comment.ts.txt", "src/__lint_fixture__.ts");
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("tkitchen(no-comments)");
  }, TEST_TIMEOUT);
  it("a shebang passes lint", async () => {
    const result = await lintFixture("shebang.ts.txt", "src/__lint_fixture__.ts");
    expect(result.code).toBe(0);
  }, TEST_TIMEOUT);
  it("a magic number in src fails lint", async () => {
    const result = await lintFixture("magic-number.ts.txt", "src/__lint_fixture__.ts");
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("no-magic-numbers");
  }, TEST_TIMEOUT);
  it("a magic number in tests passes lint", async () => {
    const result = await lintFixture("magic-number.ts.txt", "tests/__lint_fixture__.test.ts");
    expect(result.code).toBe(0);
  }, TEST_TIMEOUT);
  it("a non-exhaustive switch fails lint", async () => {
    const result = await lintFixture("switch.ts.txt", "src/__lint_fixture__.ts");
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("switch-exhaustiveness-check");
  }, TEST_TIMEOUT);
  it("an unsafe cast in src fails lint", async () => {
    const result = await lintFixture("unsafe-cast.ts.txt", "src/__lint_fixture__.ts");
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("no-unsafe-type-assertion");
  }, TEST_TIMEOUT);
});
