import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
if (process.env.FAKE_GH_FAIL === "1") { process.stderr.write("fake gh failure\n"); process.exit(1); }
const file = process.env.FAKE_GH_PRS_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "prs.json");
process.stdout.write(readFileSync(file, "utf8"));
