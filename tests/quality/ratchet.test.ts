import { describe, expect, it } from "vitest";
import {
  compare,
  countDiagnostics,
  enabledRules,
  parseRenames,
  parseReport,
  refuseRaises,
} from "../../scripts/lint-ratchet.ts";
import type { Baseline, Diagnostic } from "../../scripts/lint-ratchet.ts";

const FLOAT = "typescript/no-floating-promises";
const MAGIC = "eslint/no-magic-numbers";

function diag(file: string, rule: string, line: number): Diagnostic {
  return { file, rule, line, message: "bad " + rule };
}

const TWO_FLOATS: Baseline = { "src/a.ts": { [FLOAT]: 2 } };

describe("parseReport", () => {
  it("reads oxlint JSON into file, rule, line and message", () => {
    const report = JSON.stringify({
      diagnostics: [
        {
          message: "Promises must be awaited",
          code: "typescript(no-floating-promises)",
          filename: "src\\a.ts",
          labels: [{ span: { line: 7 } }],
        },
        { message: "Comments are not allowed.", code: "tkitchen(no-comments)", filename: "src/b.ts", labels: [] },
      ],
    });
    expect(parseReport(report)).toEqual([
      { file: "src/a.ts", rule: FLOAT, line: 7, message: "Promises must be awaited" },
      { file: "src/b.ts", rule: "tkitchen/no-comments", line: 0, message: "Comments are not allowed." },
    ]);
  });
  it("rejects output that is not an oxlint report", () => {
    expect(() => parseReport("oxlint crashed")).toThrow();
  });
});

describe("compare", () => {
  it("an unchanged count passes", () => {
    const verdict = compare([diag("src/a.ts", FLOAT, 3), diag("src/a.ts", FLOAT, 9)], TWO_FLOATS);
    expect(verdict).toEqual({ failures: [], notes: [] });
  });
  it("an added violation fails, printing file:line rule message", () => {
    const verdict = compare(
      [diag("src/a.ts", FLOAT, 3), diag("src/a.ts", FLOAT, 9), diag("src/a.ts", FLOAT, 12)],
      TWO_FLOATS,
    );
    expect(verdict.failures).toContain("src/a.ts:12 " + FLOAT + " bad " + FLOAT);
    expect(verdict.failures.some((line) => line.includes("3 > 2"))).toBe(true);
  });
  it("a violation in a file with no baseline fails", () => {
    expect(compare([diag("src/b.ts", MAGIC, 4)], {}).failures).toContain("src/b.ts:4 " + MAGIC + " bad " + MAGIC);
  });
  it("a dropped violation passes with a tighten note", () => {
    const verdict = compare([diag("src/a.ts", FLOAT, 3)], TWO_FLOATS);
    expect(verdict.failures).toEqual([]);
    expect(verdict.notes.join("\n")).toContain("tighten the baseline");
  });
});

describe("countDiagnostics", () => {
  it("counts per file and rule", () => {
    expect(
      countDiagnostics([diag("src/a.ts", FLOAT, 1), diag("src/a.ts", FLOAT, 2), diag("src/a.ts", MAGIC, 3)]),
    ).toEqual({ "src/a.ts": { [MAGIC]: 1, [FLOAT]: 2 } });
  });
});

describe("refuseRaises", () => {
  const working: Baseline = { "src/a.ts": { [FLOAT]: 2, [MAGIC]: 5 } };
  it("a new rule with existing violations passes once", () => {
    expect(refuseRaises(working, TWO_FLOATS, new Set([FLOAT]))).toEqual([]);
  });
  it("after it lands, raising that rule's count is refused", () => {
    const atBase: Baseline = { "src/a.ts": { [FLOAT]: 2, [MAGIC]: 4 } };
    const refused = refuseRaises(working, atBase, new Set([FLOAT, MAGIC]));
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain(MAGIC);
  });
  it("raising an already enabled rule is refused", () => {
    expect(refuseRaises({ "src/a.ts": { [FLOAT]: 3 } }, TWO_FLOATS, new Set([FLOAT]))).toHaveLength(1);
  });
  const moved = new Map([["modules/a.ts", "src/a.ts"]]);
  it("a renamed file keeps its baseline at the same count", () => {
    expect(refuseRaises({ "modules/a.ts": { [FLOAT]: 2 } }, TWO_FLOATS, new Set([FLOAT]), moved)).toEqual([]);
  });
  it("a raise at a renamed file is still refused", () => {
    expect(refuseRaises({ "modules/a.ts": { [FLOAT]: 3 } }, TWO_FLOATS, new Set([FLOAT]), moved)).toHaveLength(1);
  });
  it("an unrenamed new file gains no baseline from a rename", () => {
    expect(refuseRaises({ "src/b.ts": { [FLOAT]: 1 } }, TWO_FLOATS, new Set([FLOAT]), moved)).toHaveLength(1);
  });
});

describe("parseRenames", () => {
  it("reads git name-status -z output, skipping plain entries", () => {
    const text = "M\0src/kept.ts\0R077\0old dir/a file.ts\0moved.ts\0A\0src/new.ts\0";
    expect([...parseRenames(text)]).toEqual([["moved.ts", "old dir/a file.ts"]]);
  });
  it("empty output means no renames", () => {
    expect(parseRenames("").size).toBe(0);
  });
});

describe("enabledRules", () => {
  it("collects rules that are on anywhere in the config", () => {
    const config = {
      rules: { [FLOAT]: "error", "eslint/eqeqeq": "off", "eslint/max-lines": ["error", { max: 1 }] },
      overrides: [{ files: ["src/**"], rules: { [MAGIC]: ["error", {}] } }],
    };
    expect([...enabledRules(config)].toSorted()).toEqual(["eslint/max-lines", MAGIC, FLOAT]);
  });
});
