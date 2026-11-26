import { hostname, homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Clock, Ids, Random, Scheduler } from "../contract.ts";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
export class SystemScheduler implements Scheduler {
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
export class InterruptibleScheduler implements Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wake: (() => void) | null = null;
  sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (): void => {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.wake = null;
        resolve();
      };
      this.wake = done;
      this.timer = setTimeout(done, ms);
    });
  }
  interrupt(): void {
    this.wake?.();
  }
}
export class SystemRandom implements Random {
  next(): number {
    return Math.random();
  }
}
export class SystemIds implements Ids {
  next(): string {
    return randomUUID();
  }
}
export function machineName(): string {
  return hostname();
}
export function kitchenHome(env: NodeJS.ProcessEnv = process.env): string {
  const v = env["TKITCHEN_HOME"];
  return v !== undefined && v !== "" ? v : join(homedir(), ".tkitchen");
}
export function nowIso(clock: Clock): string {
  return clock.now().toISOString();
}
