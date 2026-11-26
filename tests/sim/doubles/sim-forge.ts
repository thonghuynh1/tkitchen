import { PortError } from "../../../modules/platform/index.ts";
import type { Forge, PullRequest } from "../../../modules/forge/index.ts";
import type { RepoConfig } from "../../../modules/config/index.ts";

export interface SimForgeHooks { onPortCall: (method: string) => Promise<void>; }

export class SimForge implements Forge {
  private prs: PullRequest[] = [];
  private observed: PullRequest[] = [];
  private nextNumber = 1;
  private failNextCall = false;
  private readonly hooks: SimForgeHooks | undefined;
  constructor(hooks?: SimForgeHooks) { this.hooks = hooks; }
  openPullRequest(input: { head: string; base: string; crossRepository?: boolean; author?: string }): PullRequest {
    const number = this.nextNumber;
    this.nextNumber += 1;
    const pr: PullRequest = { number, head: input.head, base: input.base, url: "https://example.invalid/pr/" + number, author: input.author ?? "teammate", crossRepository: input.crossRepository ?? false };
    this.prs.push(pr);
    return pr;
  }
  retargetPullRequest(head: string, base: string): void {
    const pr = this.prs.find((p) => p.head === head && !p.crossRepository);
    if (pr === undefined) throw new Error("no open PR for head " + head);
    pr.base = base;
  }
  closePullRequests(head: string): void { this.prs = this.prs.filter((p) => p.head !== head); }
  openPullRequests(): PullRequest[] { return this.prs.map((p) => ({ ...p })); }
  observedPullRequests(): PullRequest[] { return this.observed.map((p) => ({ ...p })); }
  failNext(): void { this.failNextCall = true; }
  get failNextArmed(): boolean { return this.failNextCall; }
  clearFaults(): void { this.failNextCall = false; }
  async listOpenPullRequests(repo: RepoConfig): Promise<PullRequest[]> {
    void repo;
    await this.hooks?.onPortCall("listOpenPullRequests");
    if (this.failNextCall) { this.failNextCall = false; throw new PortError("failed", "sim forge failure (seeded)"); }
    this.observed = this.prs.map((p) => ({ ...p }));
    return this.openPullRequests();
  }
}
