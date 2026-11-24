import { PortError } from "./ports.ts";
import type { Clock, Config, Forge, GitRepo, PullRequest, RepoConfig, Store } from "./ports.ts";
import { computeWatchedBranches, statusForBehind } from "../domain/branch/branch.ts";
import type { BranchState } from "../domain/branch/branch.ts";
import { resolveBase, markCycles } from "../domain/base/base.ts";
import type { BaseEvidence, BaseResult } from "../domain/base/base.ts";
import { baseMovedTrigger, threadFor } from "../domain/trigger/trigger.ts";
import type { Trigger } from "../domain/trigger/trigger.ts";
import type { Disposition } from "../domain/disposition/disposition.ts";

export interface RoundOptions { skipChildMoveRecheck?: boolean; writeInsideCollect?: boolean; ignoreForgeFailure?: boolean; }
export interface RoundDeps {
  config: Config; store: Store; clock: Clock; machine: string;
  makeGit: (repo: RepoConfig) => GitRepo;
  forge: Forge;
  options?: RoundOptions | undefined;
}
interface Child { branch: string; base: string; evidence: string; }
const MAX_CANDIDATES = 200;
const HEX_START = /^[0-9a-f]{7,40}$/i;
function refFor(remote: string, branch: string): string { return "refs/remotes/" + remote + "/" + branch; }
function mapsEqual(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
function cacheKey(a: string, b: string): string { return a + "\0" + b; }
async function collectAncestorCache(git: GitRepo, remote: string, heads: ReadonlyMap<string, string>): Promise<(a: string, b: string) => boolean> {
  const cache = new Map<string, boolean>();
  const branches = [...heads.keys()];
  for (const a of branches) {
    for (const b of branches) {
      const ha = heads.get(a);
      const hb = heads.get(b);
      if (a === b || (ha !== undefined && ha === hb)) cache.set(cacheKey(a, b), true);
      else cache.set(cacheKey(a, b), await git.isAncestor(refFor(remote, a), refFor(remote, b)));
    }
  }
  return (a: string, b: string): boolean => {
    const v = cache.get(cacheKey(a, b));
    if (v === undefined) throw new Error("ancestor cache miss " + a + " " + b);
    return v;
  };
}
function normalizeCreatedName(raw: string, remote: string): string {
  let name = raw.trim();
  if (name.startsWith("refs/heads/")) return name.slice("refs/heads/".length);
  if (name.startsWith("refs/remotes/")) {
    const rest = name.slice("refs/remotes/".length);
    const slash = rest.indexOf("/");
    if (slash < 0) return name;
    const segment = rest.slice(0, slash);
    if (segment !== remote && segment !== "origin") return name;
    return rest.slice(slash + 1);
  }
  if (name.startsWith(remote + "/")) return name.slice(remote.length + 1);
  if (name.startsWith("origin/")) return name.slice("origin/".length);
  return name;
}
function prTargetsByHead(prs: readonly PullRequest[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const pr of prs) {
    if (pr.crossRepository) continue;
    const arr = out.get(pr.head) ?? [];
    arr.push(pr.base);
    out.set(pr.head, arr);
  }
  return out;
}
async function gatherEvidence(git: GitRepo, repo: RepoConfig, branch: string, heads: ReadonlyMap<string, string>, prTargets: ReadonlyMap<string, string[]>): Promise<BaseEvidence> {
  const pushed = new Set(heads.keys());
  const explicit = repo.bases[branch] ?? null;
  const base: BaseEvidence = { branch, explicit, prTargets: prTargets.get(branch) ?? [], creation: null, pushed };
  if (explicit !== null && explicit !== branch && pushed.has(explicit)) return base;
  const creation = await git.creationReflog(branch);
  if (creation === null) return base;
  if (creation.createdFrom === creation.oid || (HEX_START.test(creation.createdFrom) && creation.oid.toLowerCase().startsWith(creation.createdFrom.toLowerCase()))) {
    const candidates = [...pushed].filter((c) => c !== branch).sort().slice(0, MAX_CANDIDATES);
    const matches: string[] = [];
    for (const candidate of candidates) {
      const remoteTip = await git.tipAt(refFor(repo.remote, candidate), creation.unixSeconds);
      const localTip = remoteTip === creation.oid ? null : await git.tipAt("refs/heads/" + candidate, creation.unixSeconds);
      if (remoteTip === creation.oid || localTip === creation.oid) matches.push(candidate);
      if (matches.length > 1) break;
    }
    const only = matches[0];
    const startIsAncestorOfMatch = matches.length === 1 && only !== undefined
      ? await git.isAncestor(creation.oid, refFor(repo.remote, only))
      : false;
    return { ...base, creation: { kind: "commit", matches, startIsAncestorOfMatch } };
  }
  const name = normalizeCreatedName(creation.createdFrom, repo.remote);
  const startIsAncestor = name !== branch && pushed.has(name)
    ? await git.isAncestor(creation.oid, refFor(repo.remote, name))
    : false;
  return { ...base, creation: { kind: "named", name, startIsAncestor } };
}
async function resolveAll(git: GitRepo, repo: RepoConfig, branches: string[], heads: ReadonlyMap<string, string>, prTargets: ReadonlyMap<string, string[]>): Promise<Map<string, BaseResult>> {
  const results = new Map<string, BaseResult>();
  for (const branch of branches) results.set(branch, resolveBase(await gatherEvidence(git, repo, branch, heads, prTargets)));
  return markCycles(results);
}
function collectChildren(watched: string[], resolved: Map<string, BaseResult>): Child[] {
  const children: Child[] = [];
  for (const branch of watched) {
    const result = resolved.get(branch);
    if (result?.kind === "base") children.push({ branch, base: result.base, evidence: result.evidence });
  }
  return children;
}
function indexChildren(children: Child[]): Map<string, string[]> {
  const childIndex = new Map<string, string[]>();
  for (const c of children) {
    const arr = childIndex.get(c.base) ?? [];
    arr.push(c.branch);
    childIndex.set(c.base, arr);
  }
  return childIndex;
}
function collectEvents(input: { firstRound: boolean; childIndex: Map<string, string[]>; storedHeads: ReadonlyMap<string, string>; heads: ReadonlyMap<string, string>; repo: RepoConfig; at: string; machine: string }): { events: Trigger[]; movedChildren: Set<string>; triggerByChild: Map<string, string> } {
  const events: Trigger[] = [];
  const movedChildren = new Set<string>();
  const triggerByChild = new Map<string, string>();
  if (input.firstRound) return { events, movedChildren, triggerByChild };
  for (const [base, kids] of input.childIndex) {
    const oldHead = input.storedHeads.get(base);
    const newHead = input.heads.get(base);
    if (oldHead === undefined || newHead === undefined || oldHead === newHead) continue;
    const trigger = baseMovedTrigger({ repo: input.repo.name, base, oldHead, newHead, children: kids, at: input.at, machine: input.machine });
    events.push(trigger);
    for (const kid of kids) { movedChildren.add(kid); triggerByChild.set(kid, trigger.id); }
  }
  return { events, movedChildren, triggerByChild };
}
function isStale(input: { prev: BranchState | undefined; headOid: string; baseOid: string; base: string; firstRound: boolean; moved: boolean; skipChildMoveRecheck: boolean }): boolean {
  if (input.firstRound || input.prev === undefined) return true;
  if (input.skipChildMoveRecheck) return input.moved;
  return input.prev.headOid !== input.headOid || input.prev.baseOid !== input.baseOid || input.prev.base !== input.base || input.moved;
}
async function collectStates(input: { git: GitRepo; remote: string; children: Child[]; heads: ReadonlyMap<string, string>; storedStates: ReadonlyMap<string, BranchState>; firstRound: boolean; movedChildren: Set<string>; triggerByChild: Map<string, string>; repo: RepoConfig; at: string; skipChildMoveRecheck: boolean }): Promise<{ states: BranchState[]; behindByChild: Map<string, number> }> {
  const states: BranchState[] = [];
  const behindByChild = new Map<string, number>();
  for (const c of input.children) {
    const headOid = input.heads.get(c.branch) ?? "";
    const baseOid = input.heads.get(c.base) ?? "";
    const prev = input.storedStates.get(c.branch);
    const stale = isStale({ prev, headOid, baseOid, base: c.base, firstRound: input.firstRound, moved: input.movedChildren.has(c.branch), skipChildMoveRecheck: input.skipChildMoveRecheck });
    let behindBy: number;
    if (stale || prev?.behindBy === undefined || prev?.behindBy === null) {
      behindBy = await input.git.countBehind(refFor(input.remote, c.branch), refFor(input.remote, c.base));
    } else behindBy = prev.behindBy;
    behindByChild.set(c.branch, behindBy);
    const status = statusForBehind(behindBy);
    const since = prev !== undefined && prev.status === status ? prev.since : input.at;
    const lastEventId = input.triggerByChild.get(c.branch) ?? prev?.lastEventId ?? null;
    states.push({ repo: input.repo.name, branch: c.branch, base: c.base, baseEvidence: c.evidence, headOid, baseOid, behindBy, status, since, lastEventId });
  }
  return { states, behindByChild };
}
function collectUnresolvedStates(input: { watched: string[]; resolved: Map<string, BaseResult>; heads: ReadonlyMap<string, string>; storedStates: ReadonlyMap<string, BranchState>; repo: RepoConfig; at: string }): BranchState[] {
  const states: BranchState[] = [];
  for (const branch of input.watched) {
    const result = input.resolved.get(branch);
    if (result === undefined || result.kind === "base") continue;
    const prev = input.storedStates.get(branch);
    const status = result.kind;
    const since = prev !== undefined && prev.status === status ? prev.since : input.at;
    states.push({
      repo: input.repo.name, branch, base: null,
      baseEvidence: result.kind === "ambiguous" ? result.reason : null,
      headOid: input.heads.get(branch) ?? "", baseOid: null, behindBy: null,
      status, since, lastEventId: prev?.lastEventId ?? null,
    });
  }
  return states;
}
function collectDispositions(input: { events: Trigger[]; childIndex: Map<string, string[]>; behindByChild: Map<string, number>; repo: RepoConfig; at: string }): Disposition[] {
  const dispositions: Disposition[] = [];
  for (const trigger of input.events) {
    const kids = input.childIndex.get(trigger.meta.base) ?? [];
    for (const kid of kids) {
      const behindBy = input.behindByChild.get(kid) ?? 0;
      dispositions.push({ eventId: trigger.id, thread: threadFor(input.repo.name, kid), consumer: "notice", filtered: false, outcome: behindBy > 0 ? "behind" : "up_to_date", outcomeEventId: null, ruleId: "notice.base-moved", policyVersion: 1, handbacks: [], at: input.at, meta: { behindBy } });
    }
  }
  return dispositions;
}
export async function runRoundForRepo(deps: RoundDeps, repo: RepoConfig): Promise<void> {
  const git = deps.makeGit(repo);
  const remote = repo.remote;
  const { heads, defaultBranch } = await git.lsRemoteHeads(remote);
  let prs: PullRequest[];
  try { prs = await deps.forge.listOpenPullRequests(repo); }
  catch (e) {
    if (deps.options?.ignoreForgeFailure === true && e instanceof PortError) prs = [];
    else throw e;
  }
  const storedHeads = deps.store.getRepoHeads(repo.name);
  const firstRound = storedHeads.size === 0;
  if (firstRound || !mapsEqual(storedHeads, heads)) await git.fetch(remote);
  const storedStates = deps.store.getBranchStates(repo.name);
  const isAncestor = await collectAncestorCache(git, remote, heads);
  const candidates = [...heads.keys()].filter((b) => b !== defaultBranch).sort();
  const resolved = await resolveAll(git, repo, candidates, heads, prTargetsByHead(prs));
  const bases: Record<string, string> = {};
  for (const [branch, result] of resolved) if (result.kind === "base") bases[branch] = result.base;
  const watched = computeWatchedBranches({ heads, defaultBranch, bases, isAncestor });
  const children = collectChildren(watched, resolved);
  const childIndex = indexChildren(children);
  const at = deps.clock.now().toISOString();
  const { events, movedChildren, triggerByChild } = collectEvents({ firstRound, childIndex, storedHeads, heads, repo, at, machine: deps.machine });
  const skipChildMoveRecheck = deps.options?.skipChildMoveRecheck === true;
  const writeInsideCollect = deps.options?.writeInsideCollect === true;
  if (writeInsideCollect) deps.store.beginTx?.();
  const { states, behindByChild } = await collectStates({ git, remote, children, heads, storedStates, firstRound, movedChildren, triggerByChild, repo, at, skipChildMoveRecheck });
  if (writeInsideCollect) deps.store.commitTx?.();
  states.push(...collectUnresolvedStates({ watched, resolved, heads, storedStates, repo, at }));
  const dispositions = collectDispositions({ events, childIndex, behindByChild, repo, at });
  deps.store.applyRound({ repo: repo.name, events, dispositions, branchStates: states, heads, at });
}
export async function runRounds(deps: RoundDeps, onlyRepo?: string): Promise<{ ok: boolean }> {
  const cfg = await deps.config.load();
  let ok = true;
  for (const repo of cfg.repos) {
    if (onlyRepo !== undefined && repo.name !== onlyRepo) continue;
    try { await runRoundForRepo(deps, repo); }
    catch (e) {
      ok = false;
      if (e instanceof PortError) { try { deps.store.recordRoundError(repo.name, e.message); } catch { } }
      else throw e;
    }
  }
  if (onlyRepo !== undefined && !cfg.repos.some((r) => r.name === onlyRepo)) ok = false;
  return { ok };
}
