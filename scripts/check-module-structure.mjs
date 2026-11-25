import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_MODULE_LINES = 800;

const SOURCE_FILE = /\.ts$/;
const ENV_PATTERNS = [
  { pattern: /Date\.now\(/g, label: "Date.now()" },
  { pattern: /new Date\(\s*\)/g, label: "new Date()" },
  { pattern: /setTimeout\(/g, label: "setTimeout()" },
  { pattern: /setInterval\(/g, label: "setInterval()" },
  { pattern: /Math\.random\(/g, label: "Math.random()" },
  { pattern: /randomUUID\(/g, label: "randomUUID()" },
];

export function lineCount(text) {
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/).length;
  return /\r?\n$/.test(text) ? lines - 1 : lines;
}

export function importSpecifiers(text) {
  const specifiers = [];
  for (const match of text.matchAll(/(?:^|[\s;])(?:import|export)\b[^"'\`;]*?\bfrom\s*["']([^"']+)["']/g)) specifiers.push(match[1]);
  for (const match of text.matchAll(/(?:^|[\s;])import\s*["']([^"']+)["']/g)) specifiers.push(match[1]);
  for (const match of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specifiers.push(match[1]);
  return specifiers;
}

function normalize(path) {
  const parts = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

const PURE_LIB = /^src\/modules\/[^/]+\/lib\/(?!adapters\/)/;
const ADAPTERS = /^src\/modules\/[^/]+\/lib\/adapters\//;
const ADAPTERS_ENTRY = /^src\/modules\/[^/]+\/adapters\.ts$/;
const DETERMINISTIC_BUILTINS = new Set(["node:crypto"]);

function inspectImports(path, text, errors) {
  if (!PURE_LIB.test(path)) return;
  for (const specifier of importSpecifiers(text)) {
    if (specifier.startsWith("node:")) {
      if (!DETERMINISTIC_BUILTINS.has(specifier)) {
        errors.push(path + ": imports " + specifier + "; a module's lib stays pure, only lib/adapters may import Node built-ins");
      }
      continue;
    }
    if (!specifier.startsWith(".")) continue;
    const target = normalize(join(dirname(path), specifier));
    if (ADAPTERS.test(target) || ADAPTERS_ENTRY.test(target) || target.startsWith("src/cli/")) {
      errors.push(path + ": imports " + target + "; a module's lib stays pure and may not import adapters or src/cli, use a port");
    }
  }
}

function inspectEnv(path, text, errors) {
  if (ADAPTERS.test(path)) return;
  for (const { pattern, label } of ENV_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      void match;
      errors.push(path + ": uses " + label + "; use the Clock/Scheduler/Random/Ids port");
    }
  }
}

export function inspect(files) {
  const errors = [];
  for (const [rawPath, text] of Object.entries(files)) {
    const path = normalize(rawPath);
    const lines = lineCount(text);
    if (lines > MAX_MODULE_LINES) {
      errors.push(path + ": " + lines + " lines exceeds the " + MAX_MODULE_LINES + "-line module budget");
    }
    inspectImports(path, text, errors);
    inspectEnv(path, text, errors);
  }
  return errors;
}

function collect(root, base, files) {
  const absolute = join(root, base);
  if (!existsSync(absolute)) return;
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = base + "/" + entry.name;
    if (entry.isDirectory()) collect(root, child, files);
    else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) files[child] = readFileSync(join(root, child), "utf8");
  }
}

export function checkModuleStructure(root) {
  const files = {};
  collect(root, "src", files);
  return { errors: inspect(files), count: Object.keys(files).length };
}

const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkModuleStructure(directory);
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Module structure holds: " + result.count + " production modules (" + (relative(process.cwd(), directory) || ".") + ").");
  }
}
