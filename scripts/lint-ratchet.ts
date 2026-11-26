import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Baseline = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface Diagnostic {
  readonly file: string;
  readonly rule: string;
  readonly line: number;
  readonly message: string;
}

export interface Verdict {
  readonly failures: string[];
  readonly notes: string[];
}

const BASELINE_FILE = "lint-baseline.json";
const CONFIG_FILE = ".oxlintrc.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ruleName(code: unknown): string {
  if (typeof code !== "string") return "unknown";
  const match = /^([^(]+)\((.+)\)$/.exec(code);
  return match ? match[1] + "/" + match[2] : code;
}

function firstLine(labels: unknown): number {
  if (!Array.isArray(labels)) return 0;
  const first: unknown = labels[0];
  if (!isRecord(first) || !isRecord(first.span)) return 0;
  return typeof first.span.line === "number" ? first.span.line : 0;
}

export function parseReport(text: string): Diagnostic[] {
  const report: unknown = JSON.parse(text);
  if (!isRecord(report) || !Array.isArray(report.diagnostics)) throw new Error("oxlint did not print a JSON report");
  return report.diagnostics.filter(isRecord).map((d) => ({
    file: String(d.filename).replaceAll("\\", "/"),
    rule: ruleName(d.code),
    line: firstLine(d.labels),
    message: String(d.message),
  }));
}

export function countDiagnostics(diagnostics: readonly Diagnostic[]): Baseline {
  const counts: Record<string, Record<string, number>> = {};
  for (const { file, rule } of diagnostics) {
    const rules = counts[file] ?? {};
    rules[rule] = (rules[rule] ?? 0) + 1;
    counts[file] = rules;
  }
  return counts;
}

function allowed(baseline: Baseline, file: string, rule: string): number {
  return baseline[file]?.[rule] ?? 0;
}

export function compare(diagnostics: readonly Diagnostic[], baseline: Baseline): Verdict {
  const counts = countDiagnostics(diagnostics);
  const failures: string[] = [];
  const notes: string[] = [];
  for (const [file, rules] of Object.entries(counts)) {
    for (const [rule, count] of Object.entries(rules)) {
      const limit = allowed(baseline, file, rule);
      if (count <= limit) continue;
      failures.push(
        file + " " + rule + ": " + count + " > " + limit + " in the baseline; the new ones are among these:",
      );
      for (const d of diagnostics) {
        if (d.file === file && d.rule === rule) failures.push(d.file + ":" + d.line + " " + d.rule + " " + d.message);
      }
    }
  }
  for (const [file, rules] of Object.entries(baseline)) {
    for (const [rule, limit] of Object.entries(rules)) {
      const count = allowed(counts, file, rule);
      if (count < limit)
        notes.push(
          file + " " + rule + ": " + count + " < " + limit + "; tighten the baseline with npm run lint:baseline",
        );
    }
  }
  return { failures, notes };
}

export function refuseRaises(working: Baseline, atBase: Baseline, enabledAtBase: ReadonlySet<string>): string[] {
  const refused: string[] = [];
  for (const [file, rules] of Object.entries(working)) {
    for (const [rule, count] of Object.entries(rules)) {
      const before = allowed(atBase, file, rule);
      if (count > before && enabledAtBase.has(rule)) {
        refused.push(
          file +
            " " +
            rule +
            ": baseline raised from " +
            before +
            " to " +
            count +
            "; the rule was already on at the merge base, fix the code instead",
        );
      }
    }
  }
  return refused;
}

function isOn(setting: unknown): boolean {
  const level: unknown = Array.isArray(setting) ? setting[0] : setting;
  return level !== "off" && level !== 0;
}

export function enabledRules(config: unknown): Set<string> {
  const enabled = new Set<string>();
  if (!isRecord(config)) return enabled;
  const blocks: unknown[] = [config, ...(Array.isArray(config.overrides) ? config.overrides : [])];
  for (const block of blocks) {
    if (!isRecord(block) || !isRecord(block.rules)) continue;
    for (const [rule, setting] of Object.entries(block.rules)) {
      if (isOn(setting)) enabled.add(rule);
    }
  }
  return enabled;
}

function sorted(baseline: Baseline): Baseline {
  const out: Record<string, Record<string, number>> = {};
  for (const file of Object.keys(baseline).toSorted()) {
    const rules = baseline[file] ?? {};
    out[file] = Object.fromEntries(
      Object.keys(rules)
        .toSorted()
        .map((rule) => [rule, rules[rule] ?? 0]),
    );
  }
  return out;
}

function git(root: string, args: readonly string[]): string | undefined {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout : undefined;
}

function mergeBase(root: string): string {
  const chosen = process.env.LINT_RATCHET_BASE;
  if (chosen) return chosen;
  return git(root, ["merge-base", "HEAD", "origin/main"])?.trim() ?? "HEAD";
}

function jsonAt(root: string, ref: string, path: string): unknown {
  const text = git(root, ["show", ref + ":" + path]);
  return text === undefined ? {} : JSON.parse(text);
}

function asBaseline(value: unknown): Baseline {
  return isRecord(value) ? (value as Baseline) : {};
}

function lint(root: string): Diagnostic[] {
  const bin = join(root, "node_modules", "oxlint", "bin", "oxlint");
  const result = spawnSync(process.execPath, [bin, "--format=json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return parseReport(result.stdout);
}

function main(root: string, write: boolean): number {
  const diagnostics = lint(root);
  const baselinePath = join(root, BASELINE_FILE);
  if (write) {
    writeFileSync(baselinePath, JSON.stringify(sorted(countDiagnostics(diagnostics)), null, 2) + "\n");
    console.log("Wrote " + BASELINE_FILE + " from " + diagnostics.length + " diagnostics.");
    return 0;
  }
  const working = asBaseline(JSON.parse(readFileSync(baselinePath, "utf8")));
  const base = mergeBase(root);
  const refused = refuseRaises(
    working,
    asBaseline(jsonAt(root, base, BASELINE_FILE)),
    enabledRules(jsonAt(root, base, CONFIG_FILE)),
  );
  const verdict = compare(diagnostics, working);
  for (const note of verdict.notes) console.log(note);
  const failures = [...refused, ...verdict.failures];
  if (failures.length) {
    console.error(failures.join("\n"));
    return 1;
  }
  console.log(
    "Lint ratchet holds: " +
      diagnostics.length +
      " diagnostics, none above " +
      BASELINE_FILE +
      " (merge base " +
      base.slice(0, 7) +
      ").",
  );
  return 0;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  process.exitCode = main(resolve(dirname(self), ".."), process.argv.includes("--write"));
}
