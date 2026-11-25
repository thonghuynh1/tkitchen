import { runRounds } from "../../../src/modules/rounds/lib/round.ts";
import type { SimWorld } from "../world/world.ts";

export async function pumpRound(world: SimWorld): Promise<{ ok: boolean }> {
  let settled = false;
  const promise = runRounds({ config: world.config, store: world.store, clock: world.clock, machine: "sim", makeGit: () => world.remote, forge: world.forge })
    .then((r) => { settled = true; return r; }, (e: unknown) => { settled = true; throw e; });
  while (!settled) {
    if (world.clock.pendingCount() > 0) world.clock.pumpOne();
    await new Promise<void>((resolve) => { setImmediate(resolve); });
  }
  return promise;
}
