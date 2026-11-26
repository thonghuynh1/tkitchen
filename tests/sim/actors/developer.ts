import type { SimConfig } from "../doubles/sim-config.ts";
import type { SimForge } from "../doubles/sim-forge.ts";
import type { SimRemote } from "../doubles/sim-remote.ts";
import type { VirtualClock } from "../world/clock.ts";
import type { SeededRandom } from "../world/rng.ts";
import type { Trace } from "../world/trace.ts";

const MAX_BRANCHES = 12;

export class Developer {
  private branchCounter = 0;
  private readonly rng: SeededRandom;
  private readonly remote: SimRemote;
  private readonly forge: SimForge;
  private readonly config: SimConfig;
  private readonly trace: Trace;
  private readonly clock: VirtualClock;
  constructor(deps: {
    rng: SeededRandom;
    remote: SimRemote;
    forge: SimForge;
    config: SimConfig;
    trace: Trace;
    clock: VirtualClock;
  }) {
    this.rng = deps.rng;
    this.remote = deps.remote;
    this.forge = deps.forge;
    this.config = deps.config;
    this.trace = deps.trace;
    this.clock = deps.clock;
  }
  createInitialTree(count: number): void {
    for (let i = 0; i < count; i++) {
      const base = this.rng.pick(this.remote.branchNames());
      this.branchFrom(base);
    }
  }
  branchFrom(base: string): string {
    this.branchCounter += 1;
    const name = "feat-" + this.branchCounter;
    const baseHead = this.remote.head(base);
    const otherMachine = this.rng.next() < 0.18;
    if (otherMachine) this.remote.createBranchOtherMachine(name, base);
    else if (baseHead !== undefined && this.rng.next() < 0.25) this.remote.createBranchFromCommit(name, baseHead);
    else this.remote.createBranch(name, base);
    const oid = this.remote.commitOn(name);
    const withOverride = this.rng.next() < 0.5;
    if (withOverride) this.config.setBase(name, base);
    if (otherMachine && !withOverride && this.rng.next() < 0.7) {
      const pr = this.forge.openPullRequest({ head: name, base });
      this.trace.record(this.clock.nowMs(), "actor.open-pr", name + " -> " + base + " #" + pr.number);
    }
    this.trace.record(
      this.clock.nowMs(),
      "actor.branch",
      name +
        " from " +
        base +
        " at " +
        oid +
        (withOverride ? " override" : otherMachine ? " other-machine" : " reflog"),
    );
    return name;
  }
  act(allowDelete = true): void {
    const branches = this.remote.branchNames();
    const children = branches.filter((b) => b !== this.remote.defaultBranch && this.baseOf(b) !== undefined);
    const roll = this.rng.next();
    if (roll < 0.3 || children.length === 0) {
      this.commitPush(this.rng.pick(branches));
      return;
    }
    if (roll < 0.38) {
      this.forcePushToOlder(this.rng.pick(branches));
      return;
    }
    if (roll < 0.52) {
      this.mergeBaseIntoChild(this.rng.pick(children));
      return;
    }
    if (roll < 0.62) {
      this.mergeChildIntoBase(this.rng.pick(children));
      return;
    }
    if (roll < 0.72) {
      this.prAction(branches);
      return;
    }
    if (roll < 0.87 && branches.length < MAX_BRANCHES) {
      this.branchFrom(this.rng.pick(branches));
      return;
    }
    if (branches.length > 4 && allowDelete) {
      this.deleteBranch(this.rng.pick(children.length > 0 ? children : branches));
      return;
    }
    this.commitPush(this.rng.pick(branches));
  }
  private prAction(branches: string[]): void {
    const candidates = branches.filter((b) => b !== this.remote.defaultBranch);
    if (candidates.length === 0) return;
    const open = this.forge.openPullRequests().filter((p) => !p.crossRepository);
    const roll = this.rng.next();
    if (roll < 0.4 || open.length === 0) {
      const head = this.rng.pick(candidates);
      const bases = branches.filter((b) => b !== head);
      if (bases.length === 0) return;
      const base = this.rng.pick(bases);
      const pr = this.forge.openPullRequest({ head, base });
      this.trace.record(this.clock.nowMs(), "actor.open-pr", head + " -> " + base + " #" + pr.number);
      return;
    }
    const existing = this.rng.pick(open);
    if (roll < 0.6) {
      const bases = branches.filter((b) => b !== existing.head && b !== existing.base);
      if (bases.length === 0) return;
      const base = this.rng.pick(bases);
      this.forge.retargetPullRequest(existing.head, base);
      this.trace.record(this.clock.nowMs(), "actor.retarget-pr", existing.head + " -> " + base);
      return;
    }
    if (roll < 0.75) {
      this.forge.closePullRequests(existing.head);
      this.trace.record(this.clock.nowMs(), "actor.close-pr", existing.head);
      return;
    }
    if (roll < 0.9) {
      const bases = branches.filter((b) => b !== existing.head && b !== existing.base);
      if (bases.length === 0) return;
      const base = this.rng.pick(bases);
      const pr = this.forge.openPullRequest({ head: existing.head, base });
      this.trace.record(this.clock.nowMs(), "actor.open-second-pr", existing.head + " -> " + base + " #" + pr.number);
      return;
    }
    const head = this.rng.pick(candidates);
    const bases = branches.filter((b) => b !== head);
    if (bases.length === 0) return;
    const pr = this.forge.openPullRequest({ head, base: this.rng.pick(bases), crossRepository: true });
    this.trace.record(this.clock.nowMs(), "actor.open-fork-pr", head + " #" + pr.number);
  }
  forcePushToOlder(branch: string): void {
    const history = this.remote.firstParentHistory(branch);
    if (history.length < 2) {
      this.commitPush(branch);
      return;
    }
    const older = history[history.length - 1] ?? history[1];
    if (older === undefined || older === this.remote.head(branch)) {
      this.commitPush(branch);
      return;
    }
    this.remote.forcePush(branch, older);
    this.trace.record(this.clock.nowMs(), "actor.force-push", branch + " to older " + older);
  }
  private commitPush(branch: string): void {
    const oid = this.remote.commitOn(branch);
    this.trace.record(this.clock.nowMs(), "actor.commit+push", branch + " at " + oid);
  }
  private baseOf(child: string): string | undefined {
    const explicit = this.config.repo.bases[child];
    if (explicit !== undefined) return explicit;
    const prs = this.forge.openPullRequests().filter((p) => p.head === child && !p.crossRepository);
    const prBase = prs[0]?.base;
    if (prs.length === 1 && prBase !== undefined) return prBase;
    const creation = this.remote.creationRecord(child);
    if (creation === null) return undefined;
    if (/^[0-9a-f]{7,40}$/i.test(creation.createdFrom)) return undefined;
    return creation.createdFrom;
  }
  private mergeBaseIntoChild(child: string): void {
    const base = this.baseOf(child);
    if (base === undefined || this.remote.head(base) === undefined) {
      this.commitPush(child);
      return;
    }
    const baseHead = this.remote.head(base);
    if (baseHead === undefined) {
      this.commitPush(child);
      return;
    }
    const oid = this.remote.commitOn(child, [baseHead]);
    this.trace.record(this.clock.nowMs(), "actor.merge-base-into-child", base + " into " + child + " at " + oid);
  }
  private mergeChildIntoBase(child: string): void {
    const base = this.baseOf(child);
    if (base === undefined || this.remote.head(child) === undefined) {
      this.commitPush(child);
      return;
    }
    const childHead = this.remote.head(child);
    if (childHead === undefined) {
      this.commitPush(child);
      return;
    }
    const oid = this.remote.commitOn(base, [childHead]);
    this.trace.record(this.clock.nowMs(), "actor.merge-child-into-base", child + " into " + base + " at " + oid);
  }
  private deleteBranch(branch: string): void {
    if (branch === this.remote.defaultBranch) {
      this.commitPush(branch);
      return;
    }
    this.remote.deleteBranch(branch);
    this.trace.record(this.clock.nowMs(), "actor.delete", branch);
  }
}
