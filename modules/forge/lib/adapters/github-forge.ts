import { exec, execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { PortError } from "../../../platform/index.ts";

import type { Forge, PullRequest } from "../contract.ts";
import type { RepoConfig } from "../../../config/index.ts";

export interface GhRunResult {
  stdout: string;
  stderr: string;
  code: number;
}
export type GhRunner = (args: string[], cwd: string) => Promise<GhRunResult>;

export const GH_TIMEOUT_MS = 20000;
export interface GhRunnerOptions {
  timeoutMs?: number;
}
const SHELL_SAFE_ARG = /^[\w.,=-]+$/;
const GH_ARGS = [
  "pr",
  "list",
  "--state",
  "open",
  "--json",
  "number,headRefName,baseRefName,url,author,isCrossRepository",
  "--limit",
  "200",
];

type GhDone = (err: Error | null, stdout: string, stderr: string) => void;

function startGh(args: string[], cwd: string, done: GhDone): ChildProcess {
  const env = { ...process.env, GH_PROMPT_DISABLED: "1" };
  if (process.platform !== "win32") return execFile("gh", args, { cwd, env }, done);
  return exec(["gh", ...args].join(" "), { cwd, env, windowsHide: true }, done);
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform !== "win32") {
    child.kill("SIGKILL");
    return;
  }
  spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on(
    "error",
    () => undefined,
  );
}

export function createGhRunner(options: GhRunnerOptions = {}): GhRunner {
  const timeoutMs = options.timeoutMs ?? GH_TIMEOUT_MS;
  return (args, cwd) =>
    new Promise((resolve, reject) => {
      if (!args.every((arg) => SHELL_SAFE_ARG.test(arg))) {
        reject(new PortError("failed", "gh argument is not shell-safe"));
        return;
      }
      let timedOut = false;
      const child = startGh(args, cwd, (err, stdout, stderr) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new PortError("timeout", "gh pr list timed out after " + timeoutMs + "ms"));
          return;
        }
        const code = err === null ? 0 : "code" in err && typeof err.code === "number" ? err.code : 1;
        resolve({ stdout, stderr, code });
      });
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
    });
}

export const defaultGhRunner: GhRunner = createGhRunner();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parsePullRequests(stdout: string): PullRequest[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new PortError("failed", "gh pr list returned invalid JSON");
  }
  if (!Array.isArray(parsed)) throw new PortError("failed", "gh pr list returned a non-array JSON value");
  const out: PullRequest[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) throw new PortError("failed", "gh pr list returned a malformed pull request");
    const author: unknown = item["author"];
    if (
      typeof item["number"] !== "number" ||
      typeof item["headRefName"] !== "string" ||
      typeof item["baseRefName"] !== "string" ||
      typeof item["url"] !== "string" ||
      typeof item["isCrossRepository"] !== "boolean" ||
      !isRecord(author) ||
      typeof author["login"] !== "string"
    ) {
      throw new PortError("failed", "gh pr list returned a malformed pull request");
    }
    out.push({
      number: item["number"],
      head: item["headRefName"],
      base: item["baseRefName"],
      url: item["url"],
      author: author["login"],
      crossRepository: item["isCrossRepository"],
    });
  }
  return out;
}

export class GitHubForge implements Forge {
  private readonly runner: GhRunner;
  constructor(runner: GhRunner = defaultGhRunner) {
    this.runner = runner;
  }
  async listOpenPullRequests(repo: RepoConfig): Promise<PullRequest[]> {
    let r: GhRunResult;
    try {
      r = await this.runner(GH_ARGS, repo.path);
    } catch (e) {
      if (e instanceof PortError) throw e;
      throw new PortError("failed", e instanceof Error ? e.message : String(e));
    }
    if (r.code !== 0) throw new PortError("failed", "gh pr list failed: " + r.stderr.trim());
    return parsePullRequests(r.stdout);
  }
}
