import type { Oracle, Violation } from "./oracle.ts";
import type { SimWorld } from "../world/world.ts";

export const noTxAcrossPort: Oracle = {
  id: "no-tx-across-port",
  kind: "safety",
  check(world: SimWorld): Violation[] {
    const calls = world.store.portCallsDuringTx;
    if (calls.length === 0) return [];
    return [
      {
        oracle: "no-tx-across-port",
        kind: "safety",
        detail: "port calls started while a transaction was open: " + calls.join(","),
      },
    ];
  },
};
