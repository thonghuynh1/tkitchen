import type { SimWorld } from "../world/world.ts";

export interface Violation { oracle: string; kind: "safety" | "progress"; detail: string; }
export interface Oracle { id: string; kind: "safety" | "progress"; check: (world: SimWorld) => Violation[]; }
