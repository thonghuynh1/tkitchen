import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import type { Config, KitchenConfig, RepoConfig } from "../application/ports.ts";
import { kitchenHome } from "./env.ts";

export class ConfigError extends Error { constructor(message: string) { super(message); this.name = "ConfigError"; } }
const TIMEOUT_MS = 20000;
const DEFAULT_ROUND_MINUTES = 15;

function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function reqString(obj: Record<string, unknown>, field: string, label: string): string {
  const v = obj[field];
  if (typeof v !== "string" || v === "") throw new ConfigError(label + " must be a non-empty string");
  return v;
}
function optString(obj: Record<string, unknown>, field: string, label: string, fallback: string): string {
  const v = obj[field];
  if (v === undefined) return fallback;
  if (typeof v !== "string" || v === "") throw new ConfigError(label + " must be a non-empty string");
  return v;
}
function parseBases(v: unknown, label: string): Record<string, string> {
  if (v === undefined) return {};
  if (!isRecord(v)) throw new ConfigError(label + " must be an object");
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== "string" || val === "") throw new ConfigError(label + "." + k + " must be a non-empty string");
    out[k] = val;
  }
  return out;
}
function isGitWorkTree(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("git", ["-C", path, "rev-parse", "--is-inside-work-tree"], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeout: TIMEOUT_MS }, (err, stdout) => {
      resolve(err === null && stdout.trim() === "true");
    });
  });
}
export class FileConfig implements Config {
  readonly configPath: string;
  constructor(home?: string) { this.configPath = join(home ?? kitchenHome(), "config.json"); }
  async load(): Promise<KitchenConfig> {
    let raw: string;
    try { raw = await readFile(this.configPath, "utf8"); }
    catch { throw new ConfigError("config file not found: " + this.configPath); }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new ConfigError("config file is not valid JSON: " + this.configPath); }
    if (!isRecord(parsed)) throw new ConfigError("config file must be an object: " + this.configPath);
    const reposRaw = parsed["repos"];
    if (!Array.isArray(reposRaw)) throw new ConfigError("repos must be an array in " + this.configPath);
    const repos: RepoConfig[] = [];
    for (let i = 0; i < reposRaw.length; i++) {
      const item: unknown = reposRaw[i];
      const label = "repos[" + i + "]";
      if (!isRecord(item)) throw new ConfigError(label + " must be an object");
      const repo: RepoConfig = {
        name: reqString(item, "name", label + ".name"),
        path: reqString(item, "path", label + ".path"),
        remote: optString(item, "remote", label + ".remote", "origin"),
        forge: optString(item, "forge", label + ".forge", "github"),
        bases: parseBases(item["bases"], label + ".bases"),
      };
      if (repo.forge !== "github") throw new ConfigError(label + ".forge must be \"github\" in v1: " + repo.forge);
      if (!(await isGitWorkTree(repo.path))) throw new ConfigError(label + ".path is not a git work tree: " + repo.path);
      repos.push(repo);
    }
    const rm = parsed["roundMinutes"];
    if (rm !== undefined && (typeof rm !== "number" || !(rm > 0))) throw new ConfigError("roundMinutes must be a positive number");
    return { repos, roundMinutes: rm ?? DEFAULT_ROUND_MINUTES };
  }
}
