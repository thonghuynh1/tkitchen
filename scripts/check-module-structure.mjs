import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_MODULE_LINES = 800;

const SOURCE_FILE = /\.ts$/;
const MODULE_TESTS = /^modules\/[^/]+\/tests\//;
const ADAPTERS = /^modules\/[^/]+\/lib\/adapters\//;
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
    const path = rawPath.replaceAll("\\", "/");
    if (MODULE_TESTS.test(path)) continue;
    const lines = lineCount(text);
    if (lines > MAX_MODULE_LINES) {
      errors.push(path + ": " + lines + " lines exceeds the " + MAX_MODULE_LINES + "-line module budget");
    }
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
  collect(root, "modules", files);
  collect(root, "cli", files);
  if (existsSync(join(root, "index.ts"))) files["index.ts"] = readFileSync(join(root, "index.ts"), "utf8");
  return { errors: inspect(files), count: Object.keys(files).filter((path) => !MODULE_TESTS.test(path)).length };
}

const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkModuleStructure(directory);
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Environment and size rules hold: " + result.count + " production files (" + (relative(process.cwd(), directory) || ".") + ").");
  }
}
