import { execFile } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { CliOutput } from "../contract.ts";
const run = promisify(execFile);
const FAKE_GH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "fixtures", "fake-gh");
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await run("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return r.stdout.toString();
}
export async function cli(home: string, ...args: string[]): Promise<CliOutput> {
  try {
    const env: Record<string, string | undefined> = {
      ...process.env,
      TKITCHEN_HOME: home,
      PATH: FAKE_GH_DIR + delimiter + (process.env["PATH"] ?? ""),
    };
    env["FAKE_GH_PRS_FILE"] = env["FAKE_GH_PRS_FILE"] ?? join(FAKE_GH_DIR, "prs.json");
    const r = await run("node", ["modules/cli/lib/adapters/main.ts", ...args], { cwd: process.cwd(), env });
    return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: 0 };
  } catch (e) {
    const failed: Record<string, unknown> =
      typeof e === "object" && e !== null ? Object.fromEntries(Object.entries(e)) : {};
    return {
      stdout: String(failed["stdout"] ?? ""),
      stderr: String(failed["stderr"] ?? ""),
      code: typeof failed["code"] === "number" ? failed["code"] : 1,
    };
  }
}
