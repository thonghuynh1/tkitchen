import { PortError } from "../../../src/modules/platform/lib/ports.ts";
import type { GitRepo, Ids } from "../../../src/modules/platform/lib/ports.ts";
import { GitFaultInjector } from "../faults/git-faults.ts";
import type { GitFaultKind, GitMethod } from "../faults/git-faults.ts";

export interface SimCommit { oid: string; parents: string[]; }
export interface SimRemoteHooks { onPortCall: (method: string) => Promise<void>; }

const REF_PREFIX = "refs/remotes/";

export class SimRemote implements GitRepo {
  readonly commits = new Map<string, SimCommit>();
  readonly branches = new Map<string, string>();
  readonly observedHeads = new Map<string, string>();
  private readonly creations = new Map<string, { oid: string; createdFrom: string; unixSeconds: number }>();
  private readonly tipHistory = new Map<string, { oid: string; at: number }[]>();
  private observedCreations: Map<string, { oid: string; createdFrom: string; unixSeconds: number }> | null = null;
  private observedTips: Map<string, { oid: string; at: number }[]> | null = null;
  private logicalTime = 0;
  private fetched = new Map<string, string>();
  defaultBranch: string | null = null;
  readonly faults = new GitFaultInjector();
  failNextGit(method: GitMethod | "*" = "*", kind: GitFaultKind = "failed"): void { this.faults.arm(method, kind); }
  timeoutNextGit(method: GitMethod | "*" = "*"): void { this.faults.arm(method, "timeout"); }
  clearGitFaults(): void { this.faults.clear(); }
  get gitFaultArmed(): boolean { return this.faults.isArmed; }
  private throwIfFaulted(method: string): void { const err = this.faults.consume(method); if (err !== null) throw err; }
  private readonly ids: Ids;
  private readonly hooks: SimRemoteHooks;
  constructor(ids: Ids, hooks: SimRemoteHooks) { this.ids = ids; this.hooks = hooks; }

  createCommit(parents: string[]): string {
    const oid = this.ids.next();
    this.commits.set(oid, { oid, parents: [...parents] });
    return oid;
  }
  private tick(): number { this.logicalTime += 1; return this.logicalTime; }
  private recordTip(branch: string, oid: string): number {
    const at = this.tick();
    const list = this.tipHistory.get(branch) ?? [];
    list.push({ oid, at });
    this.tipHistory.set(branch, list);
    return at;
  }
  initBranch(name: string, oid: string): void {
    this.branches.set(name, oid);
    this.recordTip(name, oid);
  }
  commitOn(branch: string, extraParents: string[] = []): string {
    const head = this.branches.get(branch);
    const parents = head === undefined ? [...extraParents] : [head, ...extraParents];
    const oid = this.createCommit(parents);
    this.branches.set(branch, oid);
    this.recordTip(branch, oid);
    return oid;
  }
  createBranch(name: string, fromBranch: string): void {
    const head = this.branches.get(fromBranch);
    if (head === undefined) throw new Error("unknown branch " + fromBranch);
    this.branches.set(name, head);
    const at = this.recordTip(name, head);
    this.creations.set(name, { oid: head, createdFrom: fromBranch, unixSeconds: at });
  }
  createBranchFromCommit(name: string, oid: string): void {
    if (!this.commits.has(oid)) throw new Error("unknown commit " + oid);
    this.branches.set(name, oid);
    const at = this.recordTip(name, oid);
    this.creations.set(name, { oid, createdFrom: oid, unixSeconds: at });
  }
  createBranchOtherMachine(name: string, fromBranch: string): void {
    const head = this.branches.get(fromBranch);
    if (head === undefined) throw new Error("unknown branch " + fromBranch);
    this.branches.set(name, head);
    this.recordTip(name, head);
  }
  creationRecord(branch: string): { oid: string; createdFrom: string; unixSeconds: number } | null {
    const c = (this.observedCreations ?? this.creations).get(branch);
    return c === undefined ? null : { ...c };
  }
  tipAtBranch(branch: string, unixSeconds: number): string | null {
    const list = (this.observedTips ?? this.tipHistory).get(branch) ?? [];
    let found: string | null = null;
    for (const entry of list) if (entry.at <= unixSeconds) found = entry.oid;
    return found;
  }
  deleteBranch(name: string): void { this.branches.delete(name); this.creations.delete(name); }
  forcePush(name: string, oid: string): void {
    if (!this.commits.has(oid)) throw new Error("unknown commit " + oid);
    this.branches.set(name, oid);
    this.recordTip(name, oid);
  }
  firstParentHistory(name: string): string[] {
    const head = this.branches.get(name);
    if (head === undefined) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = head;
    while (current !== undefined && !seen.has(current)) { seen.add(current); out.push(current); current = this.commits.get(current)?.parents[0]; }
    return out;
  }
  head(branch: string): string | undefined { return this.branches.get(branch); }
  branchNames(): string[] { return [...this.branches.keys()].sort(); }
  ancestorsOf(oid: string): Set<string> {
    const seen = new Set<string>();
    const stack = [oid];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      const commit = this.commits.get(current);
      if (commit !== undefined) for (const parent of commit.parents) stack.push(parent);
    }
    return seen;
  }
  isAncestorOid(ancestor: string, descendant: string): boolean { return this.ancestorsOf(descendant).has(ancestor); }
  countBehindOids(childOid: string, baseOid: string): number {
    const childAncestors = this.ancestorsOf(childOid);
    let count = 0;
    for (const oid of this.ancestorsOf(baseOid)) if (!childAncestors.has(oid)) count += 1;
    return count;
  }

  private branchFromRef(ref: string): string {
    if (!ref.startsWith(REF_PREFIX)) throw new PortError("failed", "unexpected ref " + ref);
    const rest = ref.slice(REF_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash < 0) throw new PortError("failed", "unexpected ref " + ref);
    return rest.slice(slash + 1);
  }
  private fetchedOid(ref: string): string {
    if (!ref.startsWith(REF_PREFIX) && this.commits.has(ref)) return ref;
    const branch = this.branchFromRef(ref);
    const oid = this.fetched.get(branch);
    if (oid === undefined) throw new PortError("failed", "unknown fetched branch " + branch);
    return oid;
  }

  fetchedHeads(): Map<string, string> { return new Map(this.fetched); }
  async lsRemoteHeads(remote: string): Promise<{ heads: Map<string, string>; defaultBranch: string | null }> {
    await this.hooks.onPortCall("lsRemoteHeads");
    this.throwIfFaulted("lsRemoteHeads");
    void remote;
    this.observedHeads.clear();
    for (const [branch, oid] of this.branches) this.observedHeads.set(branch, oid);
    this.observedCreations = new Map([...this.creations].map(([k, v]) => [k, { ...v }]));
    this.observedTips = new Map([...this.tipHistory].map(([k, v]) => [k, v.map((e) => ({ ...e }))]));
    return { heads: new Map(this.branches), defaultBranch: this.defaultBranch };
  }
  async fetch(remote: string): Promise<void> {
    await this.hooks.onPortCall("fetch");
    this.throwIfFaulted("fetch");
    void remote;
    this.fetched = new Map(this.branches);
  }
  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    await this.hooks.onPortCall("isAncestor");
    this.throwIfFaulted("isAncestor");
    return this.isAncestorOid(this.fetchedOid(ancestor), this.fetchedOid(descendant));
  }
  async containingBranches(remote: string, branch: string): Promise<string[]> {
    await this.hooks.onPortCall("containingBranches");
    this.throwIfFaulted("containingBranches");
    const oid = this.fetchedOid(REF_PREFIX + remote + "/" + branch);
    return [...this.fetched].filter(([, tip]) => this.isAncestorOid(oid, tip)).map(([name]) => name).sort();
  }
  async countBehind(child: string, base: string): Promise<number> {
    await this.hooks.onPortCall("countBehind");
    this.throwIfFaulted("countBehind");
    return this.countBehindOids(this.fetchedOid(child), this.fetchedOid(base));
  }
  async creationReflog(branch: string): Promise<{ oid: string; createdFrom: string; unixSeconds: number } | null> {
    await this.hooks.onPortCall("creationReflog");
    this.throwIfFaulted("creationReflog");
    return this.creationRecord(branch);
  }
  async tipAt(ref: string, unixSeconds: number): Promise<string | null> {
    await this.hooks.onPortCall("tipAt");
    this.throwIfFaulted("tipAt");
    let branch: string;
    if (ref.startsWith("refs/heads/")) branch = ref.slice("refs/heads/".length);
    else if (ref.startsWith(REF_PREFIX)) {
      const rest = ref.slice(REF_PREFIX.length);
      const slash = rest.indexOf("/");
      if (slash < 0) throw new PortError("failed", "unexpected ref " + ref);
      branch = rest.slice(slash + 1);
    } else throw new PortError("failed", "unexpected ref " + ref);
    return this.tipAtBranch(branch, unixSeconds);
  }
}
