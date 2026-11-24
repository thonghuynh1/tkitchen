import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setGitProcessGuard } from "../../../src/infrastructure/git/git-repo.ts";
import type { GitRunner } from "../../../src/infrastructure/git/git-repo.ts";
import { KitchenStore } from "../../../src/infrastructure/sqlite/store.ts";
import { SimConfig } from "../doubles/sim-config.ts";
import { SimForge } from "../doubles/sim-forge.ts";
import { SimRemote } from "../doubles/sim-remote.ts";
import { SimStore } from "../doubles/sim-store.ts";
import { VirtualClock } from "./clock.ts";
import { SeededIds, SeededRandom } from "./rng.ts";
import { Trace } from "./trace.ts";

export interface QuietDelta { events: number; dispositions: number; }
export interface ExportGeneration { ids: string[]; seqs: number[]; storeIds: string[]; }

const REMOTE = "origin";
const REPO = "sim";

export class SimWorld {
  readonly seed: number;
  readonly rng: SeededRandom;
  readonly clock = new VirtualClock();
  readonly ids = new SeededIds();
  readonly trace = new Trace();
  readonly config: SimConfig;
  store: SimStore;
  readonly exportGenerations: ExportGeneration[] = [{ ids: [], seqs: [], storeIds: [] }];
  exportResetCount = 0;
  readonly remote: SimRemote;
  readonly forge: SimForge;
  incompleteSnapshot: string | null = null;
  forgeFaultPending = false;
  gitFaultPending = false;
  readonly throwingGitRunner: GitRunner;
  realGitCalls = 0;
  currentPortMethod = "";
  quietDelta: QuietDelta | null = null;
  private readonly dirs: string[] = [];
  private dir: string;
  constructor(seed: number) {
    this.seed = seed;
    this.rng = new SeededRandom(seed);
    this.dir = mkdtempSync(join(tmpdir(), "tkitchen-sim-"));
    this.dirs.push(this.dir);
    const inner = new KitchenStore(join(this.dir, "kitchen.db"));
    this.store = new SimStore(inner);
    this.config = new SimConfig({ name: REPO, path: "sim", remote: REMOTE, forge: "github", bases: {} });
    this.forge = new SimForge({
      onPortCall: async (method: string): Promise<void> => {
        this.store.notePortCall(method);
        this.currentPortMethod = method;
        this.trace.record(this.clock.nowMs(), "forge." + method, "ok");
        await this.clock.sleep(1);
      },
    });
    this.remote = new SimRemote(this.ids, {
      onPortCall: async (method: string): Promise<void> => {
        this.store.notePortCall(method);
        this.currentPortMethod = method;
        this.trace.record(this.clock.nowMs(), "git." + method, "ok");
        await this.clock.sleep(1);
      },
    });
    setGitProcessGuard({ onCall: (args: string[]): void => { this.noteRealGit(args); } });
    this.throwingGitRunner = (args: string[]): Promise<never> => {
      this.noteRealGit(args);
      throw new Error("real git runner called inside a sim: git " + args.join(" "));
    };
    const root = this.remote.createCommit([]);
    this.remote.initBranch("main", root);
    this.remote.defaultBranch = "main";
    this.trace.record(this.clock.nowMs(), "world.init", "seed=" + seed + " root=" + root);
  }
  get repoName(): string { return REPO; }
  snapshotStore(): string {
    return JSON.stringify({ events: this.store.listTriggers(), dispositions: this.store.listDispositions(), branchStates: this.store.listBranchStates(), heads: this.store.listRepoHeadRows() });
  }
  noteRealGit(args: string[]): void {
    this.realGitCalls += 1;
    this.trace.record(this.clock.nowMs(), "git.real", "counted git " + args.join(" "));
  }
  replaceStoreWithFresh(): void {
    this.store.close();
    this.dir = mkdtempSync(join(tmpdir(), "tkitchen-sim-"));
    this.dirs.push(this.dir);
    this.store = new SimStore(new KitchenStore(join(this.dir, "kitchen.db")));
    this.exportGenerations.push({ ids: [], seqs: [], storeIds: [] });
    this.trace.record(this.clock.nowMs(), "world.replace-store", "fresh store generation " + this.exportGenerations.length);
  }
  currentExportGeneration(): ExportGeneration {
    const gen = this.exportGenerations[this.exportGenerations.length - 1];
    if (gen === undefined) throw new Error("no export generation");
    return gen;
  }
  dispose(): void {
    setGitProcessGuard(null);
    this.store.close();
    for (const dir of this.dirs) rmSync(dir, { recursive: true, force: true });
  }
}
