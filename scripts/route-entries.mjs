import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";

const PORTS = "src/modules/platform/lib/ports.ts";
const STATEMENT = /^(import|export)(\s+type)?\s+(\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s*from\s*(["'])(\.[^"']+)\4;?[ \t]*$/gm;
const DYNAMIC = /\bimport\(\s*(["'])(\.[^"']+)\1\s*\)/g;

function walk(dir, files) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = dir + "/" + entry.name;
    if (entry.isDirectory()) walk(path, files);
    else if (/\.(ts|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function moduleOf(path) {
  const match = /^src\/modules\/([^/]+)\//.exec(path);
  return match ? match[1] : null;
}

function exportedNames(entry) {
  const names = new Set();
  if (!existsSync(entry)) return names;
  for (const match of readFileSync(entry, "utf8").matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) if (part.trim()) names.add(part.trim());
  }
  return names;
}

const entryCache = new Map();
function entriesOf(module) {
  if (!entryCache.has(module)) {
    const root = "src/modules/" + module + "/";
    entryCache.set(module, [root + "index.ts", root + "adapters.ts"].map((path) => ({ path, names: exportedNames(path) })));
  }
  return entryCache.get(module);
}

function owner(target, name) {
  if (target === PORTS) {
    for (const module of ["platform", "git", "config", "forge", "lock", "triggers"]) {
      if (entriesOf(module)[0].names.has(name)) return { module, entry: "src/modules/" + module + "/index.ts", contract: "src/modules/" + module + "/lib/contract.ts" };
    }
    throw new Error("no owner for " + name);
  }
  const module = moduleOf(target);
  const found = entriesOf(module).find((e) => e.names.has(name));
  if (!found) throw new Error("no entry exports " + name + " from " + target);
  return { module, entry: found.path, contract: null };
}

function relativeSpecifier(from, to) {
  const next = posix.relative(posix.dirname(from), to);
  return next.startsWith(".") ? next : "./" + next;
}

function destination(file, target, name) {
  if (target !== PORTS && moduleOf(file) === moduleOf(target)) return target;
  const { module, entry, contract } = owner(target, name);
  if (moduleOf(file) === module) return contract ?? target;
  return entry;
}

function wholeModuleEntry(file, target) {
  const module = moduleOf(target);
  if (moduleOf(file) === module) return target;
  return "src/modules/" + module + (target.includes("/lib/adapters/") ? "/adapters.ts" : "/index.ts");
}

export function route(file, text) {
  const groups = new Map();
  const order = [];
  let changed = false;
  const kept = text.replace(STATEMENT, (whole, verb, typeKw, clause, quote, specifier) => {
    const target = posix.normalize(posix.join(posix.dirname(file), specifier));
    if (!target.startsWith("src/modules/") || target.endsWith("/index.ts") || target.endsWith("/adapters.ts")) return whole;
    if (!clause.startsWith("{")) {
      const next = relativeSpecifier(file, wholeModuleEntry(file, target));
      if (next === specifier) return whole;
      changed = true;
      return whole.replace(quote + specifier + quote, quote + next + quote);
    }
    const names = clause.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    const routed = names.map((spec) => ({ spec, to: destination(file, target, spec.replace(/^type\s+/, "").split(/\s+as\s+/)[0]) }));
    if (routed.every((r) => r.to === target)) return whole;
    changed = true;
    const marker = "\u0000" + order.length + "\u0000";
    for (const { spec, to } of routed) {
      const key = verb + "|" + (typeKw ? "type" : "") + "|" + to;
      if (!groups.has(key)) { groups.set(key, { verb, typeKw: typeKw ?? "", to, specs: [], marker }); order.push(key); }
      if (!groups.get(key).specs.includes(spec)) groups.get(key).specs.push(spec);
    }
    return marker;
  });
  let out = kept;
  for (const key of order) {
    const g = groups.get(key);
    const line = g.verb + g.typeKw + " { " + g.specs.join(", ") + " } from \"" + relativeSpecifier(file, g.to) + "\";";
    out = out.replace(g.marker, line + "\n" + g.marker);
  }
  out = out.replace(/\u0000\d+\u0000\n?/g, "");
  out = out.replace(DYNAMIC, (whole, quote, specifier) => {
    const target = posix.normalize(posix.join(posix.dirname(file), specifier));
    if (!target.startsWith("src/modules/") || target.endsWith("/index.ts") || target.endsWith("/adapters.ts")) return whole;
    const next = relativeSpecifier(file, wholeModuleEntry(file, target));
    if (next === specifier) return whole;
    changed = true;
    return "import(" + quote + next + quote + ")";
  });
  return changed ? out : text;
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("scripts/route-entries.mjs")) {
  let count = 0;
  for (const file of [...walk("src", []), ...walk("tests", [])]) {
    if (file === PORTS || /^src\/modules\/[^/]+\/(index|adapters)\.ts$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const next = route(file, text);
    if (next !== text) { writeFileSync(file, next); count += 1; }
  }
  console.log("routed imports in " + count + " files");
}
