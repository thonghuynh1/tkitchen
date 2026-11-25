import type { Clock, Scheduler } from "../../../src/modules/platform/index.ts";

const EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export class VirtualClock implements Clock, Scheduler {
  private virtualMs = 0;
  private readonly pending: Array<() => void> = [];
  now(): Date { return new Date(EPOCH_MS + this.virtualMs); }
  nowMs(): number { return this.virtualMs; }
  advance(ms: number): void { this.virtualMs += ms; }
  sleep(ms: number): Promise<void> {
    this.virtualMs += ms;
    return new Promise<void>((resolve) => { this.pending.push(resolve); });
  }
  pendingCount(): number { return this.pending.length; }
  pumpOne(): boolean {
    const resolve = this.pending.shift();
    if (resolve === undefined) return false;
    resolve();
    return true;
  }
}
