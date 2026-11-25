import type { Store } from "../../../src/modules/platform/lib/ports.ts";
import type { BranchState } from "../../../src/modules/branches/lib/branch.ts";
import type { Disposition } from "../../../src/modules/triggers/lib/disposition.ts";
import type { Trigger } from "../../../src/modules/triggers/lib/trigger.ts";
import type { KitchenStore, RoundStatus } from "../../../src/modules/triggers/lib/adapters/store.ts";

export class SimStore implements Store {
  readonly txLog: string[] = [];
  readonly portCallsDuringTx: string[] = [];
  private txOpen = false;
  private readonly inner: KitchenStore;
  constructor(inner: KitchenStore) { this.inner = inner; }
  getRepoHeads(repo: string): Map<string, string> { return this.inner.getRepoHeads(repo); }
  listRepoHeadRows(): { repo: string; branch: string; oid: string; seenAt: string }[] { return this.inner.listRepoHeadRows(); }
  getBranchStates(repo: string): Map<string, BranchState> { return this.inner.getBranchStates(repo); }
  listBranchStates(): BranchState[] { return this.inner.listBranchStates(); }
  listRoundStatus(): RoundStatus[] { return this.inner.listRoundStatus(); }
  listTriggers(): Trigger[] { return this.inner.listTriggers(); }
  eventIdAtSeq(seq: number): string | undefined { return this.inner.eventIdAtSeq(seq); }
  rowsAfter(seq: number): { seq: number; trigger: Trigger }[] { return this.inner.exportRowsAfter(seq); }
  listDispositions(): Disposition[] { return this.inner.listDispositions(); }
  applyRound(input: { repo: string; events: Trigger[]; dispositions: Disposition[]; branchStates: BranchState[]; heads: Map<string, string>; at: string }): void {
    this.beginTx();
    try { this.inner.applyRound(input); } finally { this.commitTx(); }
  }
  recordRoundError(repo: string, message: string): void { this.inner.recordRoundError(repo, message); }
  beginTx(): void {
    if (this.txOpen) return;
    this.txOpen = true;
    this.txLog.push("BEGIN");
  }
  commitTx(): void {
    if (!this.txOpen) return;
    this.txOpen = false;
    this.txLog.push("COMMIT");
  }
  notePortCall(method: string): void { if (this.txOpen) this.portCallsDuringTx.push(method); }
  isTxOpen(): boolean { return this.txOpen; }
  eventCount(): number { return this.inner.countRows("event"); }
  dispositionCount(): number { return this.inner.countRows("disposition"); }
  close(): void { this.inner.close(); }
}
