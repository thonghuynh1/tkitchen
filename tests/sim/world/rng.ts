import type { Ids, Random } from "../../../src/application/ports.ts";

const UINT32 = 4294967296;
const INCREMENT = 0x6d2b79f5;

export class SeededRandom implements Random {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    this.state = (this.state + INCREMENT) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  }
  nextInt(bound: number): number { return Math.floor(this.next() * bound); }
  pick<T>(items: readonly T[]): T {
    const item = items[this.nextInt(items.length)];
    if (item === undefined) throw new Error("pick from empty list");
    return item;
  }
}

export class SeededIds implements Ids {
  private counter = 0;
  next(): string {
    this.counter += 1;
    return "oid-" + String(this.counter).padStart(6, "0");
  }
}
