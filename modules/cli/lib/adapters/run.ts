import { existsSync } from "node:fs";
import { join } from "node:path";
import { FileConfig, ConfigError } from "../../../config/adapters.ts";
import { KitchenStore } from "../../../triggers/adapters.ts";
import { InterruptibleScheduler, kitchenHome, machineName, SystemClock } from "../../../platform/adapters.ts";
import { runRounds, serve } from "../../../rounds/index.ts";
import { FileLock } from "../../../lock/adapters.ts";
import { GitRepoImpl, GIT_TIMEOUT_MS } from "../../../git/adapters.ts";
import { ForgeByKind } from "../../../forge/adapters.ts";
import { getNotices, formatNotices, getHistory, formatHistory } from "../../../notices/index.ts";
import { exportLines, serializeExportLines, InvalidCursorError } from "../../../export/index.ts";
import { ReadOnlyExportStore } from "../../../export/adapters.ts";
import { startBoardServer } from "../../../board-http/adapters.ts";
import { parseCommand, USAGE } from "../parse.ts";

const EXIT_USAGE = 2;
const RADIX = 10;

function storePath(): string {
  return join(kitchenHome(), "kitchen.db");
}

function gitTimeoutMs(): number {
  const raw = process.env["TKITCHEN_GIT_TIMEOUT_MS"];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, RADIX);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : GIT_TIMEOUT_MS;
}

async function heldText(lock: FileLock): Promise<string> {
  const pid = await lock.holderPid();
  return pid === null ? "already running" : "already running (pid " + pid + ")";
}

async function loadConfig(config: FileConfig): Promise<boolean> {
  try {
    await config.load();
    return true;
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return false;
    }
    throw e;
  }
}

async function runServe(): Promise<number> {
  const config = new FileConfig();
  if (!(await loadConfig(config))) return EXIT_USAGE;
  const scheduler = new InterruptibleScheduler();
  let stopRequested = false;
  const onSignal = (): void => {
    stopRequested = true;
    scheduler.interrupt();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const lock = new FileLock();
  const store = new KitchenStore(storePath());
  try {
    const served = await serve({
      config,
      store,
      clock: new SystemClock(),
      machine: machineName(),
      makeGit: (repo) => new GitRepoImpl(repo.path, { timeoutMs: gitTimeoutMs() }),
      forge: new ForgeByKind(),
      scheduler,
      lock,
      shouldStop: () => stopRequested,
    });
    if (served.kind === "held") {
      console.error(served.pid === null ? "already running" : "already running (pid " + served.pid + ")");
      return 1;
    }
    return 0;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    store.close();
  }
}

async function runBoard(port: number, host: string): Promise<number> {
  const webRoot = join(import.meta.dirname, "..", "..", "..", "..", "dist", "web");
  if (!existsSync(join(webRoot, "index.html"))) {
    console.error("board page not built: run npm run build:web first");
    return 1;
  }
  const board = await startBoardServer({ port, host, webRoot });
  console.log("board at " + board.url);
  await new Promise<void>((resolveStop) => {
    const onSignal = (): void => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolveStop();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
  await board.close();
  return 0;
}

async function runRoundCommand(onlyRepo: string | undefined): Promise<number> {
  const config = new FileConfig();
  if (!(await loadConfig(config))) return EXIT_USAGE;
  const lock = new FileLock();
  if ((await lock.acquire()) === "held") {
    console.error(await heldText(lock));
    return 1;
  }
  const store = new KitchenStore(storePath());
  try {
    const rounds = await runRounds(
      {
        config,
        store,
        clock: new SystemClock(),
        machine: machineName(),
        makeGit: (repo) => new GitRepoImpl(repo.path, { timeoutMs: gitTimeoutMs() }),
        forge: new ForgeByKind(),
      },
      onlyRepo,
    );
    return rounds.ok ? 0 : 1;
  } finally {
    store.close();
    await lock.release();
  }
}

async function writeLine(line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const flushed = process.stdout.write(line + "\n", (error?: Error | null) => {
      if (error) reject(error);
    });
    if (flushed) {
      resolve();
      return;
    }
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      process.stdout.off("drain", onDrain);
      process.stdout.off("error", onError);
    };
    process.stdout.once("drain", onDrain);
    process.stdout.once("error", onError);
  });
}

async function runExport(after: string | undefined): Promise<number> {
  const store = new ReadOnlyExportStore(storePath());
  try {
    let lines: string[];
    try {
      lines = serializeExportLines(exportLines(store, { machine: machineName(), after }));
    } catch (e) {
      if (e instanceof InvalidCursorError) {
        console.error("invalid cursor");
        return EXIT_USAGE;
      }
      throw e;
    }
    for (const line of lines) await writeLine(line);
    return 0;
  } finally {
    store.close();
  }
}

async function runNotices(json: boolean, history: boolean): Promise<number> {
  const store = new KitchenStore(storePath());
  try {
    if (history) {
      const past = getHistory(store);
      if (json) console.log(JSON.stringify(past));
      else {
        const text = formatHistory(past);
        if (text !== "") console.log(text);
      }
      return 0;
    }
    const open = getNotices(store, new FileConfig().configPath);
    if (json) console.log(JSON.stringify({ notices: open.notices, rounds: open.rounds }));
    else {
      const text = formatNotices(open);
      if (text !== "") console.log(text);
    }
    return 0;
  } finally {
    store.close();
  }
}

export async function runCli(words: readonly string[]): Promise<number> {
  const parsed = parseCommand(words);
  if (!parsed.ok) {
    if (parsed.complaint !== null) console.error(parsed.complaint);
    if (parsed.showUsage) console.error(USAGE);
    return EXIT_USAGE;
  }
  const command = parsed.command;
  switch (command.kind) {
    case "help":
      console.log(USAGE);
      return 0;
    case "export":
      return runExport(command.after);
    case "board":
      return runBoard(command.port, command.host);
    case "serve":
      return runServe();
    case "round":
      return runRoundCommand(command.onlyRepo);
    case "notices":
      return runNotices(command.json, command.history);
  }
}
