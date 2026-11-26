import { execFile } from "node:child_process";
import { PortError } from "../../../platform/index.ts";
import type { GitRepo } from "../contract.ts";

export interface GitRunResult {
  stdout: string;
  stderr: string;
  code: number;
}
export interface GitRunnerOptions {
  timeoutMs?: number;
}
export type GitRunner = (args: string[], cwd: string, options?: GitRunnerOptions) => Promise<GitRunResult>;

export const GIT_TIMEOUT_MS = 20_000;
export interface GitProcessGuard {
  onCall: (args: string[]) => void;
}
let gitProcessGuard: GitProcessGuard | null = null;
export function setGitProcessGuard(guard: GitProcessGuard | null): void {
  gitProcessGuard = guard;
}
export function createGitRunner(options: GitRunnerOptions = {}): GitRunner {
  const defaultTimeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
  return (args, cwd, callOptions) => {
    if (gitProcessGuard !== null) {
      gitProcessGuard.onCall(args);
      return Promise.reject(
        new PortError("failed", "real git blocked inside a deterministic sim: git " + args.join(" ")),
      );
    }
    const timeoutMs = callOptions?.timeoutMs ?? defaultTimeoutMs;
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        args,
        { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeout: timeoutMs, killSignal: "SIGKILL" },
        (err, stdout, stderr) => {
          if (err !== null && typeof err === "object" && "killed" in err && err.killed === true) {
            reject(new PortError("timeout", "git " + args[0] + " timeout after " + timeoutMs + "ms"));
            return;
          }
          const code =
            err === null ? 0 : typeof err === "object" && "code" in err && typeof err.code === "number" ? err.code : 1;
          resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code });
        },
      );
    });
  };
}
export const defaultGitRunner: GitRunner = createGitRunner();

export class GitRepoImpl implements GitRepo {
  private repoPath: string;
  private runner: GitRunner;
  private readonly timeoutMs: number;
  constructor(
    repoPath: string,
    runner: GitRunner | GitRunnerOptions = defaultGitRunner,
    options: GitRunnerOptions = {},
  ) {
    this.repoPath = repoPath;
    if (typeof runner === "function") {
      this.runner = runner;
      this.timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
    } else {
      const merged = { ...runner, ...options };
      this.runner = createGitRunner(merged);
      this.timeoutMs = merged.timeoutMs ?? GIT_TIMEOUT_MS;
    }
  }
  private async run(args: string[]): Promise<GitRunResult> {
    try {
      return await this.runner(args, this.repoPath, { timeoutMs: this.timeoutMs });
    } catch (e) {
      if (e instanceof PortError) throw e;
      throw new PortError("failed", e instanceof Error ? e.message : String(e));
    }
  }
  private ref(branch: string, remote: string): string {
    return "refs/remotes/" + remote + "/" + branch;
  }
  async lsRemoteHeads(remote: string): Promise<{ heads: Map<string, string>; defaultBranch: string | null }> {
    const r = await this.run(["ls-remote", "--symref", remote, "HEAD", "refs/heads/*"]);
    if (r.code !== 0) throw new PortError("failed", "git ls-remote failed: " + r.stderr.trim());
    const heads = new Map<string, string>();
    let defaultBranch: string | null = null;
    for (const line of r.stdout.split("\n")) {
      if (line.startsWith("ref: refs/heads/")) {
        const parts = line.split(/\s+/);
        const refPart = parts[1] ?? "";
        defaultBranch = refPart.replace("refs/heads/", "");
        continue;
      }
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const oid = line.slice(0, tab).trim();
      const ref = line.slice(tab + 1).trim();
      if (ref.startsWith("refs/heads/")) heads.set(ref.replace("refs/heads/", ""), oid);
    }
    if (defaultBranch === null || !heads.has(defaultBranch)) {
      if (heads.has("main")) defaultBranch = "main";
      else if (heads.has("master")) defaultBranch = "master";
    }
    return { heads, defaultBranch };
  }
  async fetch(remote: string): Promise<void> {
    const r = await this.run(["fetch", remote, "--prune"]);
    if (r.code !== 0) throw new PortError("failed", "git fetch failed: " + r.stderr.trim());
  }
  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const r = await this.run(["merge-base", "--is-ancestor", ancestor, descendant]);
    if (r.code === 0) return true;
    if (r.code === 1) return false;
    throw new PortError("failed", "git merge-base failed: " + r.stderr.trim());
  }
  async containingBranches(remote: string, branch: string): Promise<string[]> {
    const prefix = "refs/remotes/" + remote + "/";
    const r = await this.run(["for-each-ref", "--format=%(refname)", "--contains", this.ref(branch, remote), prefix]);
    if (r.code !== 0) throw new PortError("failed", "git for-each-ref failed: " + r.stderr.trim());
    return r.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith(prefix))
      .map((l) => l.slice(prefix.length))
      .filter((b) => b !== "HEAD");
  }
  async countBehind(child: string, base: string): Promise<number> {
    const r = await this.run(["rev-list", "--count", child + ".." + base]);
    if (r.code !== 0) throw new PortError("failed", "git rev-list failed: " + r.stderr.trim());
    const n = Number.parseInt(r.stdout.trim(), 10);
    if (Number.isNaN(n)) throw new PortError("failed", "git rev-list returned non-numeric count");
    return n;
  }
  private reflogStdout(r: GitRunResult): string | null {
    if (r.code === 0) return r.stdout;
    const stderr = r.stderr.trim();
    const absent =
      /unknown revision or path not in the working tree|ambiguous argument|no reflog for|does not exist/.test(stderr);
    if (absent) return null;
    throw new PortError("failed", "git reflog failed: " + (stderr === "" ? "exit " + r.code : stderr));
  }
  async creationReflog(branch: string): Promise<{ oid: string; createdFrom: string; unixSeconds: number } | null> {
    const r = await this.run(["reflog", "show", "--date=unix", "--format=%H%x09%gd%x09%gs", "refs/heads/" + branch]);
    const stdout = this.reflogStdout(r);
    if (stdout === null) return null;
    const lines = stdout.split("\n").filter((l) => l !== "");
    const creations: { oid: string; createdFrom: string; unixSeconds: number; index: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const parts = line.split("\t");
      const SUBJECT_PART = 2;
      const subject = parts.slice(SUBJECT_PART).join("\t");
      const marker = "branch: Created from ";
      if (!subject.startsWith(marker)) continue;
      const selector = parts[1] ?? "";
      const m = /@\{([0-9]+)\}$/.exec(selector);
      if (m === null || parts[0] === undefined) continue;
      creations.push({ oid: parts[0], createdFrom: subject.slice(marker.length), unixSeconds: Number(m[1]), index: i });
    }
    if (creations.length !== 1) return null;
    const only = creations[0];
    if (only === undefined || only.index !== lines.length - 1) return null;
    return { oid: only.oid, createdFrom: only.createdFrom, unixSeconds: only.unixSeconds };
  }
  async tipAt(ref: string, unixSeconds: number): Promise<string | null> {
    const r = await this.run(["reflog", "show", "--date=unix", "--format=%H%x09%gd", ref]);
    const stdout = this.reflogStdout(r);
    if (stdout === null) return null;
    for (const line of stdout.split("\n")) {
      if (line === "") continue;
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const m = /@\{([0-9]+)\}$/.exec(line.slice(tab + 1).trim());
      if (m === null) return null;
      if (Number(m[1]) <= unixSeconds) return line.slice(0, tab).trim();
    }
    return null;
  }
  remoteRef(remote: string, branch: string): string {
    return this.ref(branch, remote);
  }
}
