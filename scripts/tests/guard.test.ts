import { describe, expect, it } from "vitest";
import { classify, unapproved } from "../lint-config-guard.ts";

const OXLINT = ".oxlintrc.json";
const FLOAT = "typescript/no-floating-promises";

function config(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    plugins: ["typescript", "unicorn"],
    categories: { correctness: "off" },
    ignorePatterns: [".scratch"],
    options: { typeAware: true },
    rules: { [FLOAT]: "error", "eslint/max-lines": ["error", { max: 1000 }] },
    overrides: [
      { files: ["src/**"], rules: { "eslint/no-magic-numbers": ["error", { ignore: [0] }] } },
      { files: ["**/tests/**"], rules: { "eslint/complexity": "off" } },
    ],
    ...extra,
  };
}

function kinds(before: unknown, after: unknown): string[] {
  return classify(OXLINT, JSON.stringify(before), JSON.stringify(after)).map((f) => f.kind);
}

function withRules(rules: Record<string, unknown>): Record<string, unknown> {
  return config({ rules });
}

describe("oxlint config", () => {
  it("an unchanged config passes", () => {
    expect(kinds(config(), config())).toEqual([]);
  });
  it("a rule lowered is flagged", () => {
    expect(kinds(config(), withRules({ [FLOAT]: "warn", "eslint/max-lines": ["error", { max: 1000 }] }))).toEqual([
      "lowered",
    ]);
  });
  it("a rule turned off is flagged, naming it", () => {
    const findings = classify(
      OXLINT,
      JSON.stringify(config()),
      JSON.stringify(withRules({ [FLOAT]: "off", "eslint/max-lines": ["error", { max: 1000 }] })),
    );
    expect(findings.map((f) => f.kind)).toEqual(["lowered"]);
    expect(findings[0]?.detail).toContain(FLOAT);
  });
  it("a rule removed is flagged", () => {
    expect(kinds(config(), withRules({ "eslint/max-lines": ["error", { max: 1000 }] }))).toEqual(["removed"]);
  });
  it("a rule added passes", () => {
    expect(
      kinds(
        config(),
        withRules({ [FLOAT]: "error", "eslint/max-lines": ["error", { max: 1000 }], "eslint/no-console": "error" }),
      ),
    ).toEqual([]);
  });
  it("a rule added as off is flagged", () => {
    expect(
      kinds(
        config(),
        withRules({ [FLOAT]: "error", "eslint/max-lines": ["error", { max: 1000 }], "eslint/no-console": "off" }),
      ),
    ).toEqual(["lowered"]);
  });
  it("changed options are unclassified", () => {
    expect(kinds(config(), withRules({ [FLOAT]: "error", "eslint/max-lines": ["error", { max: 5000 }] }))).toEqual([
      "unclassified",
    ]);
  });
  it("an ignore pattern added is flagged", () => {
    expect(kinds(config(), config({ ignorePatterns: [".scratch", "src/**"] }))).toEqual(["ignored"]);
  });
  it("a plugin removed is flagged", () => {
    expect(kinds(config(), config({ plugins: ["typescript"] }))).toEqual(["removed"]);
  });
  it("a changed top-level option is unclassified", () => {
    expect(kinds(config(), config({ options: { typeAware: false } }))).toEqual(["unclassified"]);
  });
  it("a widened override is flagged", () => {
    const after = config({
      overrides: [
        { files: ["src/**"], rules: { "eslint/no-magic-numbers": ["error", { ignore: [0] }] } },
        { files: ["**/tests/**", "src/**"], rules: { "eslint/complexity": "off" } },
      ],
    });
    expect(kinds(config(), after)).toContain("widened");
  });
  it("a new override that only turns rules on passes", () => {
    const before = config();
    const after = config({
      overrides: [
        ...(before.overrides as unknown[]),
        { files: ["scripts/**"], rules: { "eslint/no-console": "error" } },
      ],
    });
    expect(kinds(before, after)).toEqual([]);
  });
  it("removing an override that only turned rules off passes", () => {
    const after = config({
      overrides: [{ files: ["src/**"], rules: { "eslint/no-magic-numbers": ["error", { ignore: [0] }] } }],
    });
    expect(kinds(config(), after)).toEqual([]);
  });
  it("removing an override that turned rules on is flagged", () => {
    const after = config({ overrides: [{ files: ["**/tests/**"], rules: { "eslint/complexity": "off" } }] });
    expect(kinds(config(), after)).toEqual(["removed"]);
  });
  it("a file that is not JSON is unclassified", () => {
    expect(classify(OXLINT, JSON.stringify(config()), "{ broken").map((f) => f.kind)).toEqual(["unclassified"]);
  });
});

describe("other guarded files", () => {
  it("any change to the seams config is flagged", () => {
    expect(
      classify(
        ".dependency-cruiser.cjs",
        "module.exports = { forbidden: [1] };",
        "module.exports = { forbidden: [] };",
      ).map((f) => f.kind),
    ).toEqual(["seams-changed"]);
  });
  it("an opt-out entry added is flagged", () => {
    expect(
      classify("docs/lint-opt-outs.md", "# Opt-outs\n\n- `a`: why\n", "# Opt-outs\n\n- `a`: why\n- `b`: why not\n").map(
        (f) => f.kind,
      ),
    ).toEqual(["opt-out-added"]);
  });
  it("an opt-out entry removed passes", () => {
    expect(classify("docs/lint-opt-outs.md", "- `a`: why\n- `b`: why\n", "- `a`: why\n")).toEqual([]);
  });
  it("an edited checker script is flagged", () => {
    expect(
      classify("scripts/lint-ratchet.ts", "export const a = 1;\n", "export const a = 2;\n").map((f) => f.kind),
    ).toEqual(["checker-changed"]);
  });
  it("a new checker script passes", () => {
    expect(classify("scripts/oxlint/new-rule.js", undefined, "export default {};\n")).toEqual([]);
  });
  it("a changed verify script in package.json is flagged", () => {
    const before = JSON.stringify({ scripts: { verify: "npm run lint && npm test", start: "node a" } });
    const after = JSON.stringify({ scripts: { verify: "npm test", start: "node a" } });
    expect(classify("package.json", before, after).map((f) => f.kind)).toEqual(["checker-changed"]);
  });
  it("other package.json changes pass", () => {
    const before = JSON.stringify({ scripts: { verify: "npm test" }, version: "1.0.0" });
    const after = JSON.stringify({ scripts: { verify: "npm test", board: "node b" }, version: "1.1.0" });
    expect(classify("package.json", before, after)).toEqual([]);
  });
});

describe("approval", () => {
  const findings = classify(
    OXLINT,
    JSON.stringify(config()),
    JSON.stringify(withRules({ [FLOAT]: "off", "eslint/max-lines": ["error", { max: 1000 }] })),
  );
  it("the trailer clears a finding", () => {
    expect(unapproved(findings, "Ada")).toEqual([]);
  });
  it("without the trailer the finding stands", () => {
    expect(unapproved(findings, "")).toHaveLength(1);
  });
});
