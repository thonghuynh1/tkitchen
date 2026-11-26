import { exportLines } from "../../../modules/export/index.ts";
import type { SimWorld } from "../world/world.ts";

const RESET_CHANCE = 0.12;

export class Exporter {
  private cursor: string | undefined;
  private readonly world: SimWorld;
  constructor(world: SimWorld) {
    this.world = world;
  }
  run(): void {
    const lines = exportLines(this.world.store, { machine: "sim", after: this.cursor });
    const gen = this.world.currentExportGeneration();
    for (const line of lines) {
      if (line.type === "header" && line.reset) this.world.exportResetCount += 1;
      if (line.type === "event") {
        gen.ids.push(line.id);
        gen.seqs.push(line.seq);
      }
      if (line.type === "end") this.cursor = line.cursor;
    }
    gen.storeIds = this.world.store.listTriggers().map((t) => t.id);
    this.world.trace.record(
      this.world.clock.nowMs(),
      "actor.export",
      "gen=" + this.world.exportGenerations.length + " ids=" + gen.ids.length,
    );
  }
  maybeReset(): void {
    if (this.world.rng.next() >= RESET_CHANCE) return;
    this.run();
    this.world.replaceStoreWithFresh();
  }
}
