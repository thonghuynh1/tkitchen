import type { BranchState } from "../domain/branch/branch.ts";
import type { Disposition } from "../domain/disposition/disposition.ts";
import type { Trigger } from "../domain/trigger/trigger.ts";
export interface Clock { now(): Date; }
export interface Scheduler { sleep(ms: number): Promise<void>; }
export interface Random { next(): number; }
export interface Ids { next(): string; }
export interface GitRepo {
  lsRemoteHeads(remote: string): Promise<{ heads: Map<string, string>; defaultBranch: string | null }>;
  fetch(remote: string): Promise<void>;
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;
  countBehind(child: string, base: string): Promise<number>;
  creationReflog(branch: string): Promise<{ oid: string; createdFrom: string; unixSeconds: number } | null>;
  tipAt(ref: string, unixSeconds: number): Promise<string | null>;
}
export interface RepoConfig { name: string; path: string; remote: string; forge: string; bases: Record<string, string>; }
export type PullRequest = { number: number; head: string; base: string; url: string; author: string; crossRepository: boolean };
export interface Forge { listOpenPullRequests(repo: RepoConfig): Promise<PullRequest[]>; }
export interface KitchenConfig { repos: RepoConfig[]; roundMinutes: number; }
export interface Lock {
  acquire(): Promise<"acquired" | "held">;
  release(): Promise<void>;
  holderPid(): Promise<number | null>;
}
export interface Config { load(): Promise<KitchenConfig>; }
export interface RoundStatus { repo: string; lastCompleteAt: string | null; lastError: string | null; }
export interface Store {
  getRepoHeads(repo: string): Map<string, string>;
  getBranchStates(repo: string): Map<string, BranchState>;
  listBranchStates(): BranchState[];
  listRoundStatus(): RoundStatus[];
  listTriggers(): Trigger[];
  listDispositions(): Disposition[];
  applyRound(input: { repo: string; events: Trigger[]; dispositions: Disposition[]; branchStates: BranchState[]; heads: Map<string, string>; at: string }): void;
  recordRoundError(repo: string, message: string): void;
  beginTx?(): void;
  commitTx?(): void;
}
export class PortError extends Error {
  readonly kind: "timeout" | "failed";
  constructor(kind: "timeout" | "failed", message: string) { super(message); this.name = "PortError"; this.kind = kind; }
}
