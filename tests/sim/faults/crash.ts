import type { Config } from "../../../modules/config/index.ts";
import type { Forge } from "../../../modules/forge/index.ts";
import type { GitRepo } from "../../../modules/git/index.ts";
import type { Lock } from "../../../modules/lock/index.ts";
import type { Scheduler } from "../../../modules/platform/index.ts";
import type { Store } from "../../../modules/triggers/index.ts";

export class CrashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrashError";
  }
}

export class CrashInjector {
  private calls = 0;
  private readonly limit: number | null;
  private readonly crashLabel: string | null;
  private readonly onCrash: () => void;
  constructor(options: { afterCalls?: number | null; crashAtLabel?: string | null; onCrash?: () => void } = {}) {
    this.limit = options.afterCalls ?? null;
    this.crashLabel = options.crashAtLabel ?? null;
    this.onCrash = options.onCrash ?? ((): void => undefined);
  }
  get count(): number {
    return this.calls;
  }
  crossing(label: string): void {
    this.calls += 1;
    const byCount = this.limit !== null && this.calls > this.limit;
    const byLabel = this.crashLabel !== null && label === this.crashLabel;
    if (byCount || byLabel) {
      this.onCrash();
      throw new CrashError("simulated crash at " + label + " (boundary call " + this.calls + ")");
    }
  }
  wrapGit(inner: GitRepo): GitRepo {
    return {
      lsRemoteHeads: async (remote: string) => {
        this.crossing("git.lsRemoteHeads");
        return inner.lsRemoteHeads(remote);
      },
      fetch: async (remote: string) => {
        this.crossing("git.fetch");
        return inner.fetch(remote);
      },
      isAncestor: async (ancestor: string, descendant: string) => {
        this.crossing("git.isAncestor");
        return inner.isAncestor(ancestor, descendant);
      },
      containingBranches: async (remote: string, branch: string) => {
        this.crossing("git.containingBranches");
        return inner.containingBranches(remote, branch);
      },
      countBehind: async (child: string, base: string) => {
        this.crossing("git.countBehind");
        return inner.countBehind(child, base);
      },
      creationReflog: async (branch: string) => {
        this.crossing("git.creationReflog");
        return inner.creationReflog(branch);
      },
      tipAt: async (ref: string, unixSeconds: number) => {
        this.crossing("git.tipAt");
        return inner.tipAt(ref, unixSeconds);
      },
    };
  }
  wrapForge(inner: Forge): Forge {
    return {
      listOpenPullRequests: async (repo) => {
        this.crossing("forge.listOpenPullRequests");
        return inner.listOpenPullRequests(repo);
      },
    };
  }
  wrapConfig(inner: Config): Config {
    return {
      load: async () => {
        this.crossing("config.load");
        return inner.load();
      },
    };
  }
  wrapStore(inner: Store): Store {
    return {
      getRepoHeads: (repo: string) => {
        this.crossing("store.getRepoHeads");
        return inner.getRepoHeads(repo);
      },
      getBranchStates: (repo: string) => {
        this.crossing("store.getBranchStates");
        return inner.getBranchStates(repo);
      },
      listBranchStates: () => {
        this.crossing("store.listBranchStates");
        return inner.listBranchStates();
      },
      listRoundStatus: () => {
        this.crossing("store.listRoundStatus");
        return inner.listRoundStatus();
      },
      listTriggers: () => {
        this.crossing("store.listTriggers");
        return inner.listTriggers();
      },
      listDispositions: () => {
        this.crossing("store.listDispositions");
        return inner.listDispositions();
      },
      applyRound: (input) => {
        this.crossing("store.applyRound");
        inner.applyRound(input);
      },
      recordRoundError: (repo: string, message: string) => {
        this.crossing("store.recordRoundError");
        inner.recordRoundError(repo, message);
      },
      beginTx: () => {
        this.crossing("store.beginTx");
        inner.beginTx?.();
      },
      commitTx: () => {
        this.crossing("store.commitTx");
        inner.commitTx?.();
      },
    };
  }
  wrapScheduler(inner: Scheduler): Scheduler {
    return {
      sleep: async (ms: number) => {
        this.crossing("scheduler.sleep");
        return inner.sleep(ms);
      },
    };
  }
  wrapLock(inner: Lock): Lock {
    return {
      acquire: async () => {
        this.crossing("lock.acquire");
        return inner.acquire();
      },
      release: async () => {
        this.crossing("lock.release");
        return inner.release();
      },
      holderPid: async () => {
        this.crossing("lock.holderPid");
        return inner.holderPid();
      },
    };
  }
}

export function crashingGit(inner: GitRepo, afterCalls: number, onCrash: () => void): GitRepo {
  return new CrashInjector({ afterCalls, onCrash }).wrapGit(inner);
}
