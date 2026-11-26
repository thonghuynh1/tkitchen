import type { ParsedCommand } from "./contract.ts";

export const USAGE = [
  "Usage: tkitchen <command> [options]",
  "",
  "Commands:",
  "  serve              run the kitchen loop",
  "  round [--repo <name>]   run one Round for one or all repos",
  "  notices [--json] [--history]   show open Notices, or Trigger history with --history",
  "  export --json [--after <cursor>]   export Triggers for aiNho as NDJSON",
  "  board [--port <n>] [--host <addr>]   serve the waiter board page",
  "  --help             show this help",
].join("\n");

const DEFAULT_BOARD_PORT = 3000;
const DEFAULT_BOARD_HOST = "127.0.0.1";
const MAX_PORT = 65535;
const RADIX = 10;

function refused(complaint: string): ParsedCommand {
  return { ok: false, complaint, showUsage: false };
}

function parseServe(words: readonly string[]): ParsedCommand {
  for (let i = 1; i < words.length; i++) {
    return refused("unknown argument: " + words[i]);
  }
  return { ok: true, command: { kind: "serve" } };
}

function parseBoard(words: readonly string[]): ParsedCommand {
  let port = DEFAULT_BOARD_PORT;
  let host = DEFAULT_BOARD_HOST;
  for (let i = 1; i < words.length; i++) {
    const arg = words[i];
    if (arg === "--port") {
      const value = words[i + 1];
      const parsed = value === undefined ? Number.NaN : Number.parseInt(value, RADIX);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_PORT) {
        return refused("--port needs a number from 0 to " + String(MAX_PORT));
      }
      port = parsed;
      i++;
    } else if (arg === "--host") {
      const value = words[i + 1];
      if (value === undefined) {
        return refused("--host needs an address");
      }
      host = value;
      i++;
    } else {
      return refused("unknown argument: " + arg);
    }
  }
  return { ok: true, command: { kind: "board", port, host } };
}

function parseRound(words: readonly string[]): ParsedCommand {
  let onlyRepo: string | undefined;
  for (let i = 1; i < words.length; i++) {
    if (words[i] === "--repo") {
      onlyRepo = words[i + 1];
      i++;
      if (onlyRepo === undefined) {
        return refused("--repo needs a name");
      }
    } else {
      return refused("unknown argument: " + words[i]);
    }
  }
  return { ok: true, command: { kind: "round", onlyRepo } };
}

function parseExport(words: readonly string[]): ParsedCommand {
  let seenJson = false;
  let after: string | undefined;
  for (let i = 1; i < words.length; i++) {
    const arg = words[i];
    if (arg === "--json") {
      if (seenJson) {
        return refused("unknown argument: " + arg);
      }
      seenJson = true;
    } else if (arg === "--after") {
      if (after !== undefined) {
        return refused("unknown argument: " + arg);
      }
      const value = words[i + 1];
      if (value === undefined) {
        return refused("invalid cursor");
      }
      after = value;
      i++;
    } else {
      return refused("unknown argument: " + arg);
    }
  }
  if (!seenJson) {
    return { ok: false, complaint: null, showUsage: true };
  }
  return { ok: true, command: { kind: "export", after } };
}

export function parseCommand(words: readonly string[]): ParsedCommand {
  const word = words[0];
  if (word === undefined || word === "--help" || word === "-h" || word === "help") {
    return { ok: true, command: { kind: "help" } };
  }
  if (word === "export") return parseExport(words);
  if (word === "board") return parseBoard(words);
  if (word === "serve") return parseServe(words);
  if (word === "round") return parseRound(words);
  if (word === "notices") {
    return {
      ok: true,
      command: { kind: "notices", json: words.includes("--json"), history: words.includes("--history") },
    };
  }
  return { ok: false, complaint: "unknown command: " + word, showUsage: true };
}
