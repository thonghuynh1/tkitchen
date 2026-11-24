import { execFile } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const run = promisify(execFile);
const FAKE_GH_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-gh");
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await run("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return r.stdout.toString();
}
export async function cli(home: string, ...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const env: Record<string, string | undefined> = { ...process.env, TKITCHEN_HOME: home, PATH: FAKE_GH_DIR + delimiter + (process.env["PATH"] ?? "") };
    env["FAKE_GH_PRS_FILE"] = env["FAKE_GH_PRS_FILE"] ?? join(FAKE_GH_DIR, "prs.json");
    const r = await run("node", ["src/cli/tkitchen.ts", ...args], { cwd: process.cwd(), env });
    return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: 0 };
  } catch (e) {
    const err = e as { stdout?: unknown; stderr?: unknown; code?: unknown };
    return { stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? ""), code: typeof err.code === "number" ? err.code : 1 };
  }
}
