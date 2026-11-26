import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type FindingKind =
  | "lowered"
  | "removed"
  | "widened"
  | "ignored"
  | "unclassified"
  | "seams-changed"
  | "opt-out-added"
  | "checker-changed";

export interface Finding {
  readonly file: string;
  readonly kind: FindingKind;
  readonly detail: string;
}

const OXLINT = ".oxlintrc.json";
const SEAMS = ".dependency-cruiser.cjs";
const OPT_OUTS = "docs/lint-opt-outs.md";
const PACKAGE = "package.json";
const CHECKERS = new Set([
  "scripts/lint-ratchet.ts",
  "scripts/lint-config-guard.ts",
  "scripts/check-module-structure.mjs",
]);
const CHECKER_DIR = "scripts/oxlint/";
const CHECK_SCRIPTS = [
  "lint",
  "lint:baseline",
  "lint:guard",
  "typecheck",
  "seams",
  "verify:structure",
  "test",
  "test:sim",
  "verify",
];
export const GUARDED = [OXLINT, SEAMS, OPT_OUTS, PACKAGE, ...CHECKERS, CHECKER_DIR.slice(0, -1)];
const TOP_LEVEL_HANDLED = new Set(["plugins", "jsPlugins", "categories", "ignorePatterns", "rules", "overrides"]);
const OVERRIDE_HANDLED = new Set(["files", "rules"]);
const LEVELS: Record<string, number> = { error: 2, deny: 2, "2": 2, warn: 1, "1": 1, off: 0, allow: 0, "0": 0 };

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(value: Json, key: string): Json {
  const found = value[key];
  return isRecord(found) ? found : {};
}

function listAt(value: Json, key: string): unknown[] {
  const found = value[key];
  return Array.isArray(found) ? found : [];
}

function level(setting: unknown): number {
  const head: unknown = Array.isArray(setting) ? setting[0] : setting;
  return LEVELS[String(head)] ?? 0;
}

function options(setting: unknown): string {
  return Array.isArray(setting) ? JSON.stringify(setting.slice(1)) : "[]";
}

function compareRules(file: string, scope: string, before: Json, after: Json, out: Finding[]): void {
  for (const [rule, was] of Object.entries(before)) {
    if (!(rule in after)) {
      if (level(was) > 0)
        out.push({ file, kind: "removed", detail: scope + " " + rule + " removed (was " + JSON.stringify(was) + ")" });
      continue;
    }
    const now = after[rule];
    if (level(now) < level(was))
      out.push({
        file,
        kind: "lowered",
        detail: scope + " " + rule + ": " + JSON.stringify(was) + " -> " + JSON.stringify(now),
      });
    else if (level(now) > 0 && options(now) !== options(was))
      out.push({
        file,
        kind: "unclassified",
        detail: scope + " " + rule + " options changed: " + JSON.stringify(was) + " -> " + JSON.stringify(now),
      });
  }
  for (const [rule, now] of Object.entries(after)) {
    if (!(rule in before) && level(now) === 0)
      out.push({ file, kind: "lowered", detail: scope + " " + rule + " turned off" });
  }
}

function missingEntries(
  file: string,
  kind: FindingKind,
  label: string,
  from: unknown[],
  to: unknown[],
  out: Finding[],
): void {
  const kept = new Set(to.map((entry) => JSON.stringify(entry)));
  for (const entry of from) {
    if (!kept.has(JSON.stringify(entry))) out.push({ file, kind, detail: label + " " + JSON.stringify(entry) });
  }
}

function overrideKey(override: Json): string {
  return JSON.stringify(listAt(override, "files").map(String).toSorted());
}

function compareOverrides(file: string, before: unknown[], after: unknown[], topRules: Json, out: Finding[]): void {
  const was = new Map(before.filter(isRecord).map((o) => [overrideKey(o), o]));
  const now = new Map(after.filter(isRecord).map((o) => [overrideKey(o), o]));
  for (const [key, override] of was) {
    const match = now.get(key);
    const rules = recordAt(override, "rules");
    if (!match) {
      if (Object.values(rules).some((s) => level(s) > 0))
        out.push({ file, kind: "removed", detail: "override " + key + " removed while it turned rules on" });
      continue;
    }
    compareRules(file, "override " + key, rules, recordAt(match, "rules"), out);
    otherKeys(file, "override " + key, override, match, OVERRIDE_HANDLED, out);
  }
  for (const [key, override] of now) {
    if (was.has(key)) continue;
    const rules = Object.entries(recordAt(override, "rules"));
    const onlyAdds = rules.every(([rule, setting]) => level(setting) > 0 && !(rule in topRules));
    if (!onlyAdds)
      out.push({
        file,
        kind: "widened",
        detail: "override " + key + " added or its files changed, and it turns a rule off or reconfigures one",
      });
  }
}

function otherKeys(
  file: string,
  scope: string,
  before: Json,
  after: Json,
  handled: ReadonlySet<string>,
  out: Finding[],
): void {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (handled.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      out.push({
        file,
        kind: "unclassified",
        detail: scope + " " + key + ": " + JSON.stringify(before[key]) + " -> " + JSON.stringify(after[key]),
      });
  }
}

function parseJson(text: string | undefined): Json | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function classifyOxlint(beforeText: string | undefined, afterText: string | undefined): Finding[] {
  const before = parseJson(beforeText) ?? {};
  const after = parseJson(afterText);
  if (!after) return [{ file: OXLINT, kind: "unclassified", detail: "the config is missing or is not a JSON object" }];
  const out: Finding[] = [];
  compareRules(OXLINT, "rule", recordAt(before, "rules"), recordAt(after, "rules"), out);
  compareRules(OXLINT, "category", recordAt(before, "categories"), recordAt(after, "categories"), out);
  missingEntries(OXLINT, "removed", "plugin removed:", listAt(before, "plugins"), listAt(after, "plugins"), out);
  missingEntries(OXLINT, "removed", "jsPlugin removed:", listAt(before, "jsPlugins"), listAt(after, "jsPlugins"), out);
  missingEntries(
    OXLINT,
    "ignored",
    "ignore pattern added:",
    listAt(after, "ignorePatterns"),
    listAt(before, "ignorePatterns"),
    out,
  );
  compareOverrides(OXLINT, listAt(before, "overrides"), listAt(after, "overrides"), recordAt(after, "rules"), out);
  otherKeys(OXLINT, "top-level", before, after, TOP_LEVEL_HANDLED, out);
  return out;
}

function entries(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => /^\s*[-*] /.test(line))
    .map((line) => line.trim());
}

function classifyOptOuts(before: string | undefined, after: string | undefined): Finding[] {
  const was = new Set(entries(before ?? ""));
  return entries(after ?? "")
    .filter((line) => !was.has(line))
    .map((line) => ({ file: OPT_OUTS, kind: "opt-out-added" as const, detail: line }));
}

function classifyPackage(beforeText: string | undefined, afterText: string | undefined): Finding[] {
  const before = recordAt(parseJson(beforeText) ?? {}, "scripts");
  const after = recordAt(parseJson(afterText) ?? {}, "scripts");
  return CHECK_SCRIPTS.filter((name) => before[name] !== after[name]).map((name) => ({
    file: PACKAGE,
    kind: "checker-changed" as const,
    detail: "script " + name + ": " + JSON.stringify(before[name]) + " -> " + JSON.stringify(after[name]),
  }));
}

export function classify(file: string, beforeRaw: string | undefined, afterRaw: string | undefined): Finding[] {
  const before = beforeRaw?.replaceAll("\r\n", "\n");
  const after = afterRaw?.replaceAll("\r\n", "\n");
  if (before === after) return [];
  if (file === OXLINT) return classifyOxlint(before, after);
  if (file === SEAMS) return [{ file, kind: "seams-changed", detail: "the seams config changed" }];
  if (file === OPT_OUTS) return classifyOptOuts(before, after);
  if (file === PACKAGE) return classifyPackage(before, after);
  if (CHECKERS.has(file) || file.startsWith(CHECKER_DIR)) {
    return before === undefined
      ? []
      : [{ file, kind: "checker-changed", detail: after === undefined ? "checker deleted" : "checker edited" }];
  }
  return [];
}

export function unapproved(findings: readonly Finding[], approvedBy: string): Finding[] {
  return approvedBy.trim() ? [] : [...findings];
}

function git(root: string, args: readonly string[]): string | undefined {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : undefined;
}

function lines(text: string | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function startingPoint(root: string): string | undefined {
  const chosen = process.env.LINT_GUARD_BASE ?? git(root, ["merge-base", "HEAD", "origin/main"])?.trim() ?? "HEAD";
  if (git(root, ["cat-file", "-e", chosen + ":scripts/lint-config-guard.ts"]) !== undefined) return chosen;
  return lines(git(root, ["log", "--diff-filter=A", "--format=%H", "--", "scripts/lint-config-guard.ts"])).at(-1);
}

interface Report {
  readonly where: string;
  readonly finding: Finding;
  readonly hunk: string;
}

function committed(root: string, base: string): Report[] {
  const reports: Report[] = [];
  for (const commit of lines(git(root, ["rev-list", "--no-merges", "--reverse", base + "..HEAD", "--", ...GUARDED]))) {
    const approvedBy = git(root, ["log", "-1", "--format=%(trailers:key=Lint-approved-by,valueonly)", commit]) ?? "";
    const subject = git(root, ["log", "-1", "--format=%h %s", commit])?.trim() ?? commit;
    for (const file of lines(
      git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", commit, "--", ...GUARDED]),
    )) {
      const findings = classify(
        file,
        git(root, ["show", commit + "^:" + file]),
        git(root, ["show", commit + ":" + file]),
      );
      const hunk = git(root, ["show", "--format=", "-U1", commit, "--", file]) ?? "";
      for (const finding of unapproved(findings, approvedBy)) reports.push({ where: subject, finding, hunk });
    }
  }
  return reports;
}

function uncommitted(root: string): Report[] {
  const changed = [
    ...lines(git(root, ["diff", "--name-only", "HEAD", "--", ...GUARDED])),
    ...lines(git(root, ["ls-files", "--others", "--exclude-standard", "--", ...GUARDED])),
  ];
  const reports: Report[] = [];
  for (const file of changed) {
    const path = join(root, file);
    const findings = classify(
      file,
      git(root, ["show", "HEAD:" + file]),
      existsSync(path) ? readFileSync(path, "utf8") : undefined,
    );
    const hunk = git(root, ["diff", "-U1", "HEAD", "--", file]) ?? "";
    for (const finding of findings) reports.push({ where: "working tree (uncommitted, so no trailer)", finding, hunk });
  }
  return reports;
}

function main(root: string): number {
  const base = startingPoint(root);
  if (!base) {
    console.log("Lint config guard: the guard is not committed yet; nothing to check.");
    return 0;
  }
  const reports = [...committed(root, base), ...uncommitted(root)];
  if (reports.length === 0) {
    console.log("Lint config guard holds since " + base.slice(0, 7) + ": no unapproved loosening.");
    return 0;
  }
  for (const { where, finding, hunk } of reports) {
    console.error(
      finding.file + " [" + finding.kind + "] " + finding.detail + "\n  in " + where + "\n" + hunk.trimEnd() + "\n",
    );
  }
  console.error(
    reports.length +
      " unapproved finding(s). Loosening needs the user's approval: a commit touching the file with the trailer 'Lint-approved-by: <name>'.",
  );
  return 1;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  process.exitCode = main(resolve(dirname(self), ".."));
}
