import { FileLock } from "../../src/infrastructure/lock-file.ts";

const home = process.argv[2];
const lock = new FileLock(home);
let started = false;
let buffer = "";

async function acquireAndReport() {
  try {
    const result = await lock.acquire();
    process.stdout.write(JSON.stringify({ pid: process.pid, result }) + "\n");
    if (result === "held") process.exit(0);
  } catch {
    process.stdout.write(JSON.stringify({ pid: process.pid, result: "error" }) + "\n");
    process.exit(1);
  }
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!started && buffer.includes("go")) {
    started = true;
    void acquireAndReport();
  }
  if (buffer.includes("release")) {
    lock.release().then(() => { process.exit(0); }, () => { process.exit(1); });
  }
});
