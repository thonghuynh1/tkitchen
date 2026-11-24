import { execFile } from "node:child_process";
import { PortError } from "../../application/ports.ts";
import type { Forge, PullRequest, RepoConfig } from "../../application/ports.ts";

export interface GhRunResult { stdout: string; stderr: string; code: number; }
export type GhRunner = (args: string[], cwd: string) => Promise<GhRunResult>;

const TIMEOUT_MS = 20000;
const GH_ARGS = ["pr", "list", "--state", "open", "--json", "number,headRefName,baseRefName,url,author,isCrossRepository", "--limit", "200"];

export const defaultGhRunner: GhRunner = (args, cwd) => new Promise((resolve, reject) => {
  execFile("gh", args, { cwd, env: { ...process.env, GH_PROMPT_DISABLED: "1" }, timeout: TIMEOUT_MS, shell: process.platform === "win32" }, (err, stdout, stderr) => {
    if (err !== null && typeof err === "object" && "killed" in err && err.killed === true) { reject(new PortError("timeout", "gh pr list timed out after 20s")); return; }
    const code = err === null ? 0 : (typeof err === "object" && "code" in err && typeof err.code === "number" ? err.code : 1);
    resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code });
  });
});

function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }

export function parsePullRequests(stdout: string): PullRequest[] {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch { throw new PortError("failed", "gh pr list returned invalid JSON"); }
  if (!Array.isArray(parsed)) throw new PortError("failed", "gh pr list returned a non-array JSON value");
  const out: PullRequest[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) throw new PortError("failed", "gh pr list returned a malformed pull request");
    const author: unknown = item["author"];
    if (typeof item["number"] !== "number" || typeof item["headRefName"] !== "string" || typeof item["baseRefName"] !== "string"
      || typeof item["url"] !== "string" || typeof item["isCrossRepository"] !== "boolean"
      || !isRecord(author) || typeof author["login"] !== "string") {
      throw new PortError("failed", "gh pr list returned a malformed pull request");
    }
    out.push({ number: item["number"], head: item["headRefName"], base: item["baseRefName"], url: item["url"], author: author["login"], crossRepository: item["isCrossRepository"] });
  }
  return out;
}

export class GitHubForge implements Forge {
  private readonly runner: GhRunner;
  constructor(runner: GhRunner = defaultGhRunner) { this.runner = runner; }
  async listOpenPullRequests(repo: RepoConfig): Promise<PullRequest[]> {
    let r: GhRunResult;
    try { r = await this.runner(GH_ARGS, repo.path); }
    catch (e) { if (e instanceof PortError) throw e; throw new PortError("failed", e instanceof Error ? e.message : String(e)); }
    if (r.code !== 0) throw new PortError("failed", "gh pr list failed: " + r.stderr.trim());
    return parsePullRequests(r.stdout);
  }
}
