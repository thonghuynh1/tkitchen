#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FAKE_GH_DIR = join(REPO, "tests", "fixtures", "fake-gh");
const CLI = join(REPO, "src", "cli", "tkitchen.ts");

function die(msg) { console.error(msg); process.exit(2); }
function paths(run) {
  const root = resolve(run);
  return { root, home: join(root, "home"), origin: join(root, "origin.git"), prs: join(root, "prs.json"), log: join(root, "transcript.log"), state: join(root, "state.json") };
}
function log(p, text) { appendFileSync(p.log, text.endsWith("\n") ? text : text + "\n"); }
function env(p, extra = {}) {
  return { ...process.env, TKITCHEN_HOME: p.home, PATH: FAKE_GH_DIR + delimiter + process.env.PATH, FAKE_GH_PRS_FILE: p.prs, GIT_TERMINAL_PROMPT: "0", ...extra };
}
function git(cwd, ...args) { return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim(); }
function clonePath(p, name) { return join(p.root, name); }
function readConfig(p) { return JSON.parse(readFileSync(join(p.home, "config.json"), "utf8")); }
function writeConfig(p, cfg) { writeFileSync(join(p.home, "config.json"), JSON.stringify(cfg, null, 2)); }

const commands = {
  new(run) {
    const p = paths(run);
    if (existsSync(p.root)) die("run dir exists: " + p.root);
    mkdirSync(p.home, { recursive: true });
    git(p.root, "init", "--bare", "-b", "main", p.origin);
    for (const who of ["dev", "mate"]) {
      const c = clonePath(p, who);
      git(p.root, "clone", "-q", p.origin, c);
      git(c, "config", "user.email", who + "@verify.invalid"); git(c, "config", "user.name", who); git(c, "config", "commit.gpgsign", "false");
    }
    const dev = clonePath(p, "dev");
    git(dev, "checkout", "-q", "-b", "main");
    writeFileSync(join(dev, "main.txt"), "main\n"); git(dev, "add", "."); git(dev, "commit", "-q", "-m", "main");
    git(dev, "push", "-q", "-u", "origin", "main");
    git(clonePath(p, "mate"), "fetch", "-q", "origin"); git(clonePath(p, "mate"), "checkout", "-q", "main");
    writeFileSync(p.prs, "[]");
    writeConfig(p, { repos: [{ name: "x", path: dev, bases: {} }] });
    log(p, "# world created " + new Date().toISOString() + " repo=" + REPO + " head=" + git(REPO, "rev-parse", "HEAD"));
    console.log(p.root);
  },
  branch(run, who, name, from) {
    const p = paths(run); const c = clonePath(p, who);
    git(c, "fetch", "-q", "origin");
    git(c, "checkout", "-q", "-b", name, "origin/" + from);
    writeFileSync(join(c, name + ".txt"), name + "\n"); git(c, "add", "."); git(c, "commit", "-q", "-m", name);
    git(c, "push", "-q", "-u", "origin", name);
    log(p, "$ [" + who + "] branch " + name + " from " + from + " -> " + git(c, "rev-parse", "--short", "HEAD"));
  },
  "branch-oid"(run, who, name, from) {
    const p = paths(run); const c = clonePath(p, who);
    git(c, "fetch", "-q", "origin");
    const oid = git(c, "rev-parse", "origin/" + from);
    git(c, "branch", name, oid); git(c, "checkout", "-q", name);
    writeFileSync(join(c, name + ".txt"), name + "\n"); git(c, "add", "."); git(c, "commit", "-q", "-m", name);
    git(c, "push", "-q", "-u", "origin", name);
    log(p, "$ [" + who + "] branch " + name + " at oid " + oid.slice(0, 8) + " of " + from);
  },
  "set-url"(run, url) {
    const p = paths(run); git(clonePath(p, "dev"), "remote", "set-url", "origin", url === "ORIGIN" ? p.origin : url);
    log(p, "$ set-url " + url);
  },
  refs(run) { const p = paths(run); const out = git(p.origin, "for-each-ref", "--format=%(refname) %(objectname)"); console.log(out); },
  commit(run, who, branch, count = "1") {
    const p = paths(run); const c = clonePath(p, who);
    git(c, "fetch", "-q", "origin");
    git(c, "checkout", "-q", "-B", branch, "origin/" + branch);
    for (let i = 0; i < Number(count); i++) { const f = branch + "-" + Date.now() + "-" + i + ".txt"; writeFileSync(join(c, f), f); git(c, "add", "."); git(c, "commit", "-q", "-m", f); }
    git(c, "push", "-q", "origin", branch);
    log(p, "$ [" + who + "] commit " + count + " on " + branch + " -> " + git(c, "rev-parse", "--short", "HEAD"));
  },
  merge(run, who, into, from) {
    const p = paths(run); const c = clonePath(p, who);
    git(c, "fetch", "-q", "origin"); git(c, "checkout", "-q", "-B", into, "origin/" + into);
    git(c, "merge", "-q", "--no-ff", "-m", "merge " + from, "origin/" + from); git(c, "push", "-q", "origin", into);
    log(p, "$ [" + who + "] merge " + from + " into " + into);
  },
  prs(run, json) {
    const p = paths(run);
    const list = JSON.parse(json).map(([head, base, fork], i) => ({ number: i + 1, headRefName: head, baseRefName: base, url: "https://example.invalid/pr/" + (i + 1), author: { login: "mate" }, isCrossRepository: fork === "fork" }));
    writeFileSync(p.prs, JSON.stringify(list));
    log(p, "$ prs " + json);
  },
  bases(run, json) {
    const p = paths(run); const cfg = readConfig(p); cfg.repos[0].bases = JSON.parse(json); writeConfig(p, cfg);
    log(p, "$ bases " + json);
  },
  kt(run, ...rest) {
    const p = paths(run);
    const sep = rest.indexOf("--");
    const extras = Object.fromEntries((sep < 0 ? [] : rest.slice(0, sep)).map((kv) => kv.split(/=(.*)/s).slice(0, 2)));
    const args = sep < 0 ? rest : rest.slice(sep + 1);
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: REPO, env: env(p, extras), encoding: "utf8" });
    log(p, "$ " + Object.entries(extras).map(([k, v]) => k + "=" + v + " ").join("") + "tkitchen " + args.join(" ") + "\n" + r.stdout + (r.stderr ? "[stderr]\n" + r.stderr : "") + "[exit " + r.status + "]");
    process.stdout.write(r.stdout); process.stderr.write(r.stderr);
    process.exit(r.status ?? 1);
  },
  "serve-start"(run, minutes) {
    const p = paths(run);
    if (minutes !== undefined) { const cfg = readConfig(p); cfg.roundMinutes = Number(minutes); writeConfig(p, cfg); }
    const out = join(p.root, "serve.log");
    const child = spawn(process.execPath, [CLI, "serve"], { cwd: REPO, env: env(p), detached: true, stdio: ["ignore", "ignore", "ignore"] });
    child.unref();
    const st = existsSync(p.state) ? JSON.parse(readFileSync(p.state, "utf8")) : {};
    st.servePids = [...(st.servePids ?? []), child.pid]; writeFileSync(p.state, JSON.stringify(st));
    log(p, "$ serve-start pid=" + child.pid + " (output discarded; see " + out + " not written)");
    console.log(child.pid);
  },
  sql(run, query) {
    const p = paths(run);
    const r = spawnSync(process.execPath, ["-e", "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(JSON.stringify(d.prepare(process.argv[2]).all(),null,1))", join(p.home, "kitchen.db"), query], { encoding: "utf8" });
    log(p, "$ sql " + query + "\n" + r.stdout + r.stderr);
    process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  },
  doctor(run) {
    const p = paths(run); const out = [];
    const node = process.versions.node; const [maj, min] = node.split(".").map(Number);
    out.push(["node>=22.19", node, maj > 22 || (maj === 22 && min >= 19)]);
    out.push(["git", spawnSync("git", ["--version"], { encoding: "utf8" }).stdout.trim(), spawnSync("git", ["--version"]).status === 0]);
    out.push(["deps installed", join(REPO, "node_modules"), existsSync(join(REPO, "node_modules", "vitest"))]);
    out.push(["world exists", p.root, existsSync(join(p.home, "config.json"))]);
    out.push(["home isolated", p.home, resolve(p.home) !== resolve(join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".tkitchen"))]);
    const fake = spawnSync("gh", ["pr", "list"], { env: env(p), encoding: "utf8", shell: process.platform === "win32" });
    out.push(["fake gh first on PATH", fake.stdout.trim().slice(0, 40), fake.status === 0 && fake.stdout.trim().startsWith("[")]);
    const lock = join(p.home, "kitchen.lock");
    out.push(["lock", existsSync(lock) ? readFileSync(lock, "utf8").trim().slice(0, 80) : "absent", true]);
    for (const [k, v, ok] of out) console.log((ok ? "ok   " : "FAIL ") + k + ": " + v);
    log(p, "$ doctor\n" + out.map(([k, v, ok]) => (ok ? "ok " : "FAIL ") + k + ": " + v).join("\n"));
    process.exit(out.every(([, , ok]) => ok) ? 0 : 1);
  },
  cleanup(run) {
    const p = paths(run);
    const st = existsSync(p.state) ? JSON.parse(readFileSync(p.state, "utf8")) : {};
    for (const pid of st.servePids ?? []) { try { process.kill(pid); log(p, "$ cleanup killed serve pid " + pid); } catch { log(p, "$ cleanup serve pid " + pid + " already gone"); } }
    st.servePids = []; writeFileSync(p.state, JSON.stringify(st));
    console.log("cleaned " + p.root + " (transcript kept: " + p.log + ")");
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !commands[cmd]) die("usage: vt.mjs <" + Object.keys(commands).join("|") + "> <run> ...");
commands[cmd](...args);
