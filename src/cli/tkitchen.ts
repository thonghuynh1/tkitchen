#!/usr/bin/env node
import { join } from "node:path";
import { FileConfig, ConfigError } from "../infrastructure/config-file.ts";
import { KitchenStore } from "../infrastructure/sqlite/store.ts";
import { kitchenHome, machineName, SystemClock } from "../infrastructure/env.ts";
import { runRounds } from "../application/round.ts";
import { GitRepoImpl, GIT_TIMEOUT_MS } from "../infrastructure/git/git-repo.ts";
import { GitHubForge } from "../infrastructure/github/github-forge.ts";
import { getNotices, formatNotices, getHistory, formatHistory } from "../application/notices.ts";

const USAGE = [
  "Usage: tkitchen <command> [options]",
  "",
  "Commands:",
  "  serve              run the kitchen loop (not implemented yet)",
  "  round [--repo <name>]   run one Round for one or all repos",
  "  notices [--json] [--history]   show open Notices, or Trigger history with --history",
  "  export             export records for aiNho (not implemented yet)",
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

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || cmd === "help") { console.log(USAGE); return 0; }
  if (cmd === "serve" || cmd === "export") { console.log("not implemented yet"); return EXIT_USAGE; }
  if (cmd === "round") {
    let onlyRepo: string | undefined;
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === "--repo") { onlyRepo = argv[i + 1]; i++; if (onlyRepo === undefined) { console.error("--repo needs a name"); return EXIT_USAGE; } }
      else { console.error("unknown argument: " + argv[i]); return EXIT_USAGE; }
    }
    const config = new FileConfig();
    try { await config.load(); } catch (e) {
      if (e instanceof ConfigError) { console.error(e.message); return EXIT_USAGE; } throw e;
    }
    const store = new KitchenStore(storePath());
    try {
      const result = await runRounds({ config, store, clock: new SystemClock(), machine: machineName(), makeGit: (repo) => new GitRepoImpl(repo.path, { timeoutMs: gitTimeoutMs() }), forge: new GitHubForge() }, onlyRepo);
      return result.ok ? 0 : 1;
    } finally { store.close(); }
  }
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
