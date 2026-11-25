import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { posix } from "node:path";

export const MOVE_PLAN = [
  { from: "src/domain/trigger/trigger.ts", to: "src/modules/triggers/lib/trigger.ts" },
  { from: "src/domain/disposition/disposition.ts", to: "src/modules/triggers/lib/disposition.ts" },
  { from: "src/infrastructure/sqlite/store.ts", to: "src/modules/triggers/lib/adapters/store.ts" },
  { from: "src/domain/branch/branch.ts", to: "src/modules/branches/lib/branch.ts" },
  { from: "src/domain/base/base.ts", to: "src/modules/branches/lib/base.ts" },
  { from: "src/domain/notice/notice.ts", to: "src/modules/notices/lib/notice.ts" },
  { from: "src/application/notices.ts", to: "src/modules/notices/lib/notices.ts" },
  { from: "src/application/round.ts", to: "src/modules/rounds/lib/round.ts" },
  { from: "src/application/serve.ts", to: "src/modules/rounds/lib/serve.ts" },
  { from: "src/application/export.ts", to: "src/modules/export/lib/export.ts" },
  { from: "src/infrastructure/sqlite/export-store.ts", to: "src/modules/export/lib/adapters/export-store.ts" },
  { from: "src/infrastructure/git/git-repo.ts", to: "src/modules/git/lib/adapters/git-repo.ts" },
  { from: "src/infrastructure/forges.ts", to: "src/modules/forge/lib/adapters/forges.ts" },
  { from: "src/infrastructure/github/github-forge.ts", to: "src/modules/forge/lib/adapters/github-forge.ts" },
  { from: "src/infrastructure/config-file.ts", to: "src/modules/config/lib/adapters/config-file.ts" },
  { from: "src/infrastructure/lock-file.ts", to: "src/modules/lock/lib/adapters/lock-file.ts" },
  { from: "src/infrastructure/env.ts", to: "src/modules/platform/lib/adapters/env.ts" },
  { from: "src/application/ports.ts", to: "src/modules/platform/lib/ports.ts" },
];

const ROOTS = ["src", "tests", "scripts"];
const SOURCE = /\.(ts|mts|mjs|js)$/;
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.{1,2}\/[^"']+)\2/g;

function walk(dir, files) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = dir + "/" + entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walk(path, files);
    } else if (SOURCE.test(entry.name)) files.push(path);
  }
  return files;
}

export function rewriteImports(text, oldPath, newPath, moves) {
  return text.replace(SPECIFIER, (whole, lead, quote, specifier) => {
    const target = posix.normalize(posix.join(posix.dirname(oldPath), specifier));
    const moved = moves.get(target) ?? target;
    let next = posix.relative(posix.dirname(newPath), moved);
    if (!next.startsWith(".")) next = "./" + next;
    return next === specifier ? whole : lead + quote + next + quote;
  });
}

function removeEmptyDirs(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(dir + "/" + entry.name);
  }
  if (readdirSync(dir).length === 0) rmdirSync(dir);
}

export function run(plan) {
  const pending = plan.filter((m) => existsSync(m.from));
  const moves = new Map(pending.map((m) => [m.from, m.to]));
  let rewritten = 0;
  for (const file of ROOTS.flatMap((root) => walk(root, []))) {
    const text = readFileSync(file, "utf8");
    const next = rewriteImports(text, file, moves.get(file) ?? file, moves);
    if (next !== text) { writeFileSync(file, next); rewritten += 1; }
  }
  for (const { from, to } of pending) {
    mkdirSync(posix.dirname(to), { recursive: true });
    execFileSync("git", ["mv", from, to]);
  }
  for (const dir of ["src/domain", "src/application", "src/infrastructure"]) removeEmptyDirs(dir);
  return { moved: pending.length, rewritten };
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("scripts/move-modules.mjs")) {
  const result = run(MOVE_PLAN);
  console.log("moved " + result.moved + " files, rewrote imports in " + result.rewritten + " files");
}
