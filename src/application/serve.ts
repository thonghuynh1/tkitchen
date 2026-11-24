import { PortError } from "./ports.ts";
import type { Clock, Config, Forge, GitRepo, Lock, RepoConfig, Scheduler, Store } from "./ports.ts";
import type { RoundDeps, RoundOptions } from "./round.ts";
import { runRoundForRepo } from "./round.ts";

export const MINUTE_MS = 60_000;

export interface ServeDeps {
  config: Config;
  store: Store;
  clock: Clock;
  machine: string;
  makeGit: (repo: RepoConfig) => GitRepo;
  forge: Forge;
  scheduler: Scheduler;
  lock: Lock;
  shouldStop?: (() => boolean) | undefined;
  onCycle?: (() => void) | undefined;
  options?: RoundOptions | undefined;
}

export type ServeResult =
  | { kind: "held"; pid: number | null }
  | { kind: "stopped" };

export async function serve(deps: ServeDeps): Promise<ServeResult> {
  const acquired = await deps.lock.acquire();
  if (acquired === "held") return { kind: "held", pid: await deps.lock.holderPid() };
  const roundDeps: RoundDeps = {
    config: deps.config,
    store: deps.store,
    clock: deps.clock,
    machine: deps.machine,
    makeGit: deps.makeGit,
    forge: deps.forge,
    options: deps.options,
  };
  try {
    while (deps.shouldStop?.() !== true) {
      const cfg = await deps.config.load();
      for (const repo of cfg.repos) {
        try {
          await runRoundForRepo(roundDeps, repo);
        } catch (e) {
          if (e instanceof PortError) {
            try { deps.store.recordRoundError(repo.name, e.message); } catch { }
          } else throw e;
        }
        if (deps.shouldStop?.() === true) break;
      }
      deps.onCycle?.();
      if (deps.shouldStop?.() === true) break;
      await deps.scheduler.sleep(cfg.roundMinutes * MINUTE_MS);
    }
  } finally {
    await deps.lock.release();
  }
  return { kind: "stopped" };
}
