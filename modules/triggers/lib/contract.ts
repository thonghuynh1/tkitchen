import type { BranchState } from "../../branches/index.ts";
import type { Disposition } from "./disposition.ts";
import type { Trigger } from "./trigger.ts";

export interface RoundStatus {
  repo: string;
  lastCompleteAt: string | null;
  lastError: string | null;
}
export interface Store {
  getRepoHeads(repo: string): Map<string, string>;
  getBranchStates(repo: string): Map<string, BranchState>;
  listBranchStates(): BranchState[];
  listRoundStatus(): RoundStatus[];
  listTriggers(): Trigger[];
  listDispositions(): Disposition[];
  applyRound(input: {
    repo: string;
    events: Trigger[];
    dispositions: Disposition[];
    branchStates: BranchState[];
    heads: Map<string, string>;
    at: string;
  }): void;
  recordRoundError(repo: string, message: string): void;
  beginTx?(): void;
  commitTx?(): void;
}
