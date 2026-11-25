#!/usr/bin/env node
import { join } from "node:path";
import { FileConfig, ConfigError } from "../modules/config/lib/adapters/config-file.ts";
import { KitchenStore } from "../modules/triggers/lib/adapters/store.ts";
import { InterruptibleScheduler, kitchenHome, machineName, SystemClock } from "../modules/platform/lib/adapters/env.ts";
import { runRounds } from "../modules/rounds/lib/round.ts";
import { serve } from "../modules/rounds/lib/serve.ts";
import { FileLock } from "../modules/lock/lib/adapters/lock-file.ts";
import { GitRepoImpl, GIT_TIMEOUT_MS } from "../modules/git/lib/adapters/git-repo.ts";
import { ForgeByKind } from "../modules/forge/lib/adapters/forges.ts";
import { getNotices, formatNotices, getHistory, formatHistory } from "../modules/notices/lib/notices.ts";
import { exportLines, serializeExportLines, InvalidCursorError } from "../modules/export/lib/export.ts";
import { ReadOnlyExportStore } from "../modules/export/lib/adapters/export-store.ts";

const USAGE = [
  "Usage: tkitchen <command> [options]",
  "",
  "Commands:",
  "  serve              run the kitchen loop",
  "  round [--repo <name>]   run one Round for one or all repos",
  "  notices [--json] [--history]   show open Notices, or Trigger history with --history",
  "  export --json [--after <cursor>]   export Triggers for aiNho as NDJSON",
  "  --help             show this help",
].join("\n");

const EXIT_USAGE = 2;
const ARGV_COMMAND_INDEX = 2;
function storePath(): string { return join(kitchenHome(), "kitchen.db"); }
function gitTimeoutMs(): number {
  const raw = process.env["TKITCHEN_GIT_TIMEOUT_MS"];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : GIT_TIMEOUT_MS;
}

async function heldMessage(lock: FileLock): Promise<string> {
  const pid = await lock.holderPid();
  return pid === null ? "already running" : "already running (pid " + pid + ")";
}

async function runServe(argv: string[]): Promise<number> {
  for (let i = 1; i < argv.length; i++) { console.error("unknown argument: " + argv[i]); return EXIT_USAGE; }
  const config = new FileConfig();
  try { await config.load(); } catch (e) {
    if (e instanceof ConfigError) { console.error(e.message); return EXIT_USAGE; } throw e;
  }
  const scheduler = new InterruptibleScheduler();
  let stopRequested = false;
  const onSignal = (): void => { stopRequested = true; scheduler.interrupt(); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const lock = new FileLock();
  const store = new KitchenStore(storePath());
  try {
    const result = await serve({
      config, store, clock: new SystemClock(), machine: machineName(),
      makeGit: (repo) => new GitRepoImpl(repo.path, { timeoutMs: gitTimeoutMs() }),
      forge: new ForgeByKind(), scheduler, lock,
      shouldStop: () => stopRequested,
    });
    if (result.kind === "held") {
      console.error(result.pid === null ? "already running" : "already running (pid " + result.pid + ")");
      return 1;
    }
    return 0;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    store.close();
  }
}

async function runRoundCommand(argv: string[]): Promise<number> {
  let onlyRepo: string | undefined;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--repo") { onlyRepo = argv[i + 1]; i++; if (onlyRepo === undefined) { console.error("--repo needs a name"); return EXIT_USAGE; } }
    else { console.error("unknown argument: " + argv[i]); return EXIT_USAGE; }
  }
  const config = new FileConfig();
  try { await config.load(); } catch (e) {
    if (e instanceof ConfigError) { console.error(e.message); return EXIT_USAGE; } throw e;
  }
  const lock = new FileLock();
  if (await lock.acquire() === "held") { console.error(await heldMessage(lock)); return 1; }
  const store = new KitchenStore(storePath());
  try {
    const result = await runRounds({ config, store, clock: new SystemClock(), machine: machineName(), makeGit: (repo) => new GitRepoImpl(repo.path, { timeoutMs: gitTimeoutMs() }), forge: new ForgeByKind() }, onlyRepo);
    return result.ok ? 0 : 1;
  } finally { store.close(); await lock.release(); }
}

async function writeLine(line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const flushed = process.stdout.write(line + "\n", (error?: Error | null) => { if (error) reject(error); });
    if (flushed) { resolve(); return; }
    const onDrain = (): void => { cleanup(); resolve(); };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => { process.stdout.off("drain", onDrain); process.stdout.off("error", onError); };
    process.stdout.once("drain", onDrain);
    process.stdout.once("error", onError);
  });
}

async function runExport(argv: string[]): Promise<number> {
  let seenJson = false;
  let after: string | undefined;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") { if (seenJson) { console.error("unknown argument: " + arg); return EXIT_USAGE; } seenJson = true; }
    else if (arg === "--after") {
      if (after !== undefined) { console.error("unknown argument: " + arg); return EXIT_USAGE; }
      const value = argv[i + 1];
      if (value === undefined) { console.error("invalid cursor"); return EXIT_USAGE; }
      after = value; i++;
    } else { console.error("unknown argument: " + arg); return EXIT_USAGE; }
  }
  if (!seenJson) { console.error(USAGE); return EXIT_USAGE; }
  const store = new ReadOnlyExportStore(storePath());
  try {
    let lines: string[];
    try { lines = serializeExportLines(exportLines(store, { machine: machineName(), after })); }
    catch (e) { if (e instanceof InvalidCursorError) { console.error("invalid cursor"); return EXIT_USAGE; } throw e; }
    for (const line of lines) await writeLine(line);
    return 0;
  } finally { store.close(); }
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || cmd === "help") { console.log(USAGE); return 0; }
  if (cmd === "export") return runExport(argv);
  if (cmd === "serve") return runServe(argv);
  if (cmd === "round") return runRoundCommand(argv);
  if (cmd === "notices") {
    const json = argv.includes("--json");
    const history = argv.includes("--history");
    const store = new KitchenStore(storePath());
    try {
      if (history) {
        const result = getHistory(store);
        if (json) console.log(JSON.stringify(result));
        else { const text = formatHistory(result); if (text !== "") console.log(text); }
        return 0;
      }
      const result = getNotices(store, new FileConfig().configPath);
      if (json) console.log(JSON.stringify({ notices: result.notices, rounds: result.rounds }));
      else { const text = formatNotices(result); if (text !== "") console.log(text); }
      return 0;
    } finally { store.close(); }
  }
  console.error("unknown command: " + cmd);
  console.error(USAGE);
  return EXIT_USAGE;
}
main(process.argv.slice(ARGV_COMMAND_INDEX)).then((code) => { process.exitCode = code; }).catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
