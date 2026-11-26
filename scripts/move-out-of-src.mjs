import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const self = fileURLToPath(import.meta.url);

const moduleMoves = existsSync(join(root, "src", "modules"))
  ? readdirSync(join(root, "src", "modules"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ from: "src/modules/" + entry.name, to: "modules/" + entry.name }))
  : [];

const MOVES = [
  ...moduleMoves,
  { from: "src/cli/tkitchen.ts", to: "cli/tkitchen.ts" },
  { from: "src/index.ts", to: "index.ts" },
];

const REWRITES = [
  ["../../../../tests/", "../../../tests/"],
  ["src/__lint_fixture__.ts", "modules/__lint_fixture__.ts"],
  ["src/modules/", "modules/"],
  ["src\\modules\\", "modules\\"],
  ["src/cli/", "cli/"],
  ["src\\cli\\", "cli\\"],
  ["src/index.ts", "index.ts"],
];

const TEXT_FILE = /\.(ts|mts|mjs|js|cjs|json|ps1)$/;

function git(args) {
  execFileSync("git", args, { cwd: root, stdio: "inherit" });
}

function moveAll() {
  let moved = 0;
  for (const { from, to } of MOVES) {
    if (!existsSync(join(root, from))) continue;
    if (existsSync(join(root, to))) throw new Error("target already exists: " + to);
    mkdirSync(join(root, dirname(to)), { recursive: true });
    git(["mv", from, to]);
    moved += 1;
    console.log("moved " + from + " -> " + to);
  }
  return moved;
}

function collect(base, files) {
  const absolute = join(root, base);
  if (!existsSync(absolute)) return;
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = base + "/" + entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") collect(child, files);
    } else if (TEXT_FILE.test(entry.name)) files.push(child);
  }
}

function rewriteAll() {
  const files = [];
  for (const base of ["modules", "cli", "tests", "scripts", "deploy"]) collect(base, files);
  files.push("index.ts", "lint-baseline.json", "package.json", ".dependency-cruiser.cjs", ".verification-skills/verify-tkitchen/scripts/vt.mjs");
  let changed = 0;
  for (const file of files) {
    const absolute = join(root, file);
    if (!existsSync(absolute) || absolute === self) continue;
    let text = readFileSync(absolute, "utf8");
    const before = text;
    for (const [from, to] of REWRITES) text = text.replaceAll(from, to);
    if (text !== before) {
      writeFileSync(absolute, text);
      changed += 1;
      console.log("rewrote " + file);
    }
  }
  return changed;
}

const moved = moveAll();
const changed = rewriteAll();
console.log("moves=" + moved + " rewrites=" + changed);
if (moved === 0 && changed === 0) console.log("nothing to do; already moved");
