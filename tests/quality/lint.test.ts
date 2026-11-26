import { execFile } from "node:child_process";
import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { avoidedIn, avoidedTerms, identifierWords } from "../../scripts/oxlint/design-rules.js";

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
      const linted = await run("node", [OXLINT, target], { cwd: ROOT });
      return { code: 0, output: linted.stdout.toString() + linted.stderr.toString() };
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
    const linted = await lintFixture("floating-promise.ts.txt", "modules/__lint_fixture__.ts");
    expect(linted.code).not.toBe(0);
    expect(linted.output).toContain("no-floating-promises");
  }, TEST_TIMEOUT);
  it("a comment fails lint", async () => {
    const linted = await lintFixture("comment.ts.txt", "modules/__lint_fixture__.ts");
    expect(linted.code).not.toBe(0);
    expect(linted.output).toContain("tkitchen(no-comments)");
  }, TEST_TIMEOUT);
  it("a shebang passes lint", async () => {
    const linted = await lintFixture("shebang.ts.txt", "modules/__lint_fixture__.ts");
    expect(linted.code).toBe(0);
  }, TEST_TIMEOUT);
  it("a magic number in src fails lint", async () => {
    const linted = await lintFixture("magic-number.ts.txt", "modules/__lint_fixture__.ts");
    expect(linted.code).not.toBe(0);
    expect(linted.output).toContain("no-magic-numbers");
  }, TEST_TIMEOUT);
  it("a magic number in tests passes lint", async () => {
    const linted = await lintFixture("magic-number.ts.txt", "tests/__lint_fixture__.test.ts");
    expect(linted.code).toBe(0);
  }, TEST_TIMEOUT);
  it("a non-exhaustive switch fails lint", async () => {
    const linted = await lintFixture("switch.ts.txt", "modules/__lint_fixture__.ts");
    expect(linted.code).not.toBe(0);
    expect(linted.output).toContain("switch-exhaustiveness-check");
  }, TEST_TIMEOUT);
  it("an unsafe cast in src fails lint", async () => {
    const linted = await lintFixture("unsafe-cast.ts.txt", "modules/__lint_fixture__.ts");
    expect(linted.code).not.toBe(0);
    expect(linted.output).toContain("no-unsafe-type-assertion");
  }, TEST_TIMEOUT);
  it("a name using a word CONTEXT.md avoids fails lint", async () => {
    const linted = await lintFixture("context-term.ts.txt", "modules/__lint_fixture__.ts");
    expect(linted.code).not.toBe(0);
    expect(linted.output).toContain("design(context-terms)");
    expect(linted.output).toContain("Station");
  }, TEST_TIMEOUT);
  it("an as cast fails lint, in tests too", async () => {
    const linted = await lintFixture("unsafe-as.ts.txt", "tests/__lint_fixture__.test.ts");
    expect(linted.code).not.toBe(0);
    expect(linted.output).toContain("design(no-unsafe-as)");
  }, TEST_TIMEOUT);
  it("as const and a cast to a type parameter pass no-unsafe-as", async () => {
    const linted = await lintFixture("safe-casts.ts.txt", "tests/__lint_fixture__.test.ts");
    expect(linted.output).not.toContain("design(no-unsafe-as)");
  }, TEST_TIMEOUT);
  it("a file that only re-exports one file fails lint", async () => {
    const linted = await lintFixture("pass-through.ts.txt", "modules/__lint_fixture__.ts");
    expect(linted.code).not.toBe(0);
    expect(linted.output).toContain("design(no-pass-through)");
  }, TEST_TIMEOUT);
  it("a bare string id type and id parameter fail lint", async () => {
    const linted = await lintFixture("branded-ids.ts.txt", "modules/__lint_fixture__.ts");
    expect(linted.code).not.toBe(0);
    expect(linted.output).toContain("design(branded-ids)");
    expect(linted.output).toContain("\"CardId\" is a bare string");
    expect(linted.output).toContain("\"cardId\" is a bare string");
  }, TEST_TIMEOUT);
});

describe("context terms", () => {
  const station = "**Station**:\nA consumer.\n_Avoid_: dish, handler, worker (a worker is a tstack or Pi agent)\n";
  it("reads each _Avoid_ word with its term, dropping the notes in brackets", () => {
    expect(avoidedTerms(station).map((t) => [t.term, t.phrase])).toEqual([["Station", "dish"], ["Station", "handler"], ["Station", "worker"]]);
  });
  it("splits identifiers into words", () => {
    expect(identifierWords("GitRunResult")).toEqual(["git", "run", "result"]);
    expect(identifierWords("HTTPServer")).toEqual(["http", "server"]);
    expect(identifierWords("last_event_id")).toEqual(["last", "event", "id"]);
  });
  it("matches whole words, plurals and multi-word phrases", () => {
    const terms = avoidedTerms("**Watched branch**:\nx\n_Avoid_: tracked branch, active branch\n**Trigger**:\nx\n_Avoid_: event\n");
    expect(avoidedIn("trackedBranches", terms)?.phrase).toBe("tracked branch");
    expect(avoidedIn("listEvents", terms)?.term).toBe("Trigger");
    expect(avoidedIn("eventually", terms)).toBeUndefined();
    expect(avoidedIn("branchTracker", terms)).toBeUndefined();
  });
  it("reads the real CONTEXT.md", () => {
    const phrases = avoidedTerms(readFileSync(join(ROOT, "CONTEXT.md"), "utf8")).map((t) => t.phrase);
    expect(phrases).toContain("handler");
    expect(phrases).toContain("event");
  });
});
