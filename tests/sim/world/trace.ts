import { createHash } from "node:crypto";

export interface TraceEntry {
  step: number;
  virtualMs: number;
  event: string;
  outcome: string;
}

export class Trace {
  private entries: TraceEntry[] = [];
  private step = 0;
  record(virtualMs: number, event: string, outcome: string): void {
    this.step += 1;
    this.entries.push({ step: this.step, virtualMs, event, outcome });
  }
  all(): readonly TraceEntry[] {
    return this.entries;
  }
  last(count: number): TraceEntry[] {
    return this.entries.slice(Math.max(0, this.entries.length - count));
  }
  hash(): string {
    const hash = createHash("sha256");
    for (const entry of this.entries) hash.update(JSON.stringify(entry) + "\n", "utf8");
    return hash.digest("hex");
  }
}

export function formatTrace(entries: readonly TraceEntry[]): string {
  return entries.map((e) => "#" + e.step + " @" + e.virtualMs + "ms " + e.event + " -> " + e.outcome).join("\n");
}
