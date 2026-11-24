import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
import { join } from "node:path";

const home = process.argv[2];
const mode = process.argv[3];
const lockPath = join(home, "kitchen.lock");
const takeoverPath = join(home, "kitchen.lock.takeover");

async function pause(tag) {
  process.send({ type: "checkpoint", tag, pid: process.pid });
  await once(process, "message");
}

const originalRead = fs.readFile;
let paused = false;
if (mode === "delayed-stale-read") {
  fs.readFile = async (...args) => {
    const value = await originalRead(...args);
    if (!paused && String(args[0]) === lockPath) {
      paused = true;
      await pause("delayed-stale-read");
    }
    return value;
  };
} else if (mode === "delayed-takeover-read") {
  fs.readFile = async (...args) => {
    const value = await originalRead(...args);
    if (!paused && String(args[0]) === takeoverPath) {
      paused = true;
      await pause("delayed-takeover-read");
    }
    return value;
  };
}
syncBuiltinESMExports();

const { FileLock } = await import("../../src/infrastructure/lock-file.ts");
const lock = new FileLock(home);
const result = await lock.acquire();
process.send({ type: "result", pid: process.pid, result });
await once(process, "message");
if (result === "acquired") await lock.release();
process.exit(0);
