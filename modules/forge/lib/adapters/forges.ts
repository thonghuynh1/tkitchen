import { PortError } from "../../../platform/index.ts";
import type { Forge, PullRequest } from "../contract.ts";
import type { RepoConfig } from "../../../config/index.ts";
import { GitHubForge } from "./github-forge.ts";

export const FORGE_KINDS: readonly string[] = ["github", "none"];

export class NoForge implements Forge {
  async listOpenPullRequests(): Promise<PullRequest[]> {
    return [];
  }
}

export class ForgeByKind implements Forge {
  readonly forges: Readonly<Record<string, Forge>>;
  constructor(forges?: Readonly<Record<string, Forge>>) {
    this.forges = forges ?? { github: new GitHubForge(), none: new NoForge() };
  }
  async listOpenPullRequests(repo: RepoConfig): Promise<PullRequest[]> {
    const forge = this.forges[repo.forge];
    if (forge === undefined) throw new PortError("failed", "unknown forge for " + repo.name + ": " + repo.forge);
    return forge.listOpenPullRequests(repo);
  }
}
