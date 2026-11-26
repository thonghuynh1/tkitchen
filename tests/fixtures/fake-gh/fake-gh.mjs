import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
if (process.env.FAKE_GH_FAIL === "1") {
  process.stderr.write("fake gh failure\n");
  process.exit(1);
}
if (process.env.FAKE_GH_PID_FILE) writeFileSync(process.env.FAKE_GH_PID_FILE, String(process.pid));
const file = process.env.FAKE_GH_PRS_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "prs.json");
const sleepMs = Number(process.env.FAKE_GH_SLEEP_MS ?? "0");
setTimeout(() => {
  process.stdout.write(readFileSync(file, "utf8"));
}, sleepMs);
