import { hostname, homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Clock, Ids, Random, Scheduler } from "../application/ports.ts";

export class SystemClock implements Clock { now(): Date { return new Date(); } }
export class SystemScheduler implements Scheduler { sleep(ms: number): Promise<void> { return new Promise((resolve) => { setTimeout(resolve, ms); }); } }
export class SystemRandom implements Random { next(): number { return Math.random(); } }
export class SystemIds implements Ids { next(): string { return randomUUID(); } }
export function machineName(): string { return hostname(); }
export function kitchenHome(env: NodeJS.ProcessEnv = process.env): string {
  const v = env["TKITCHEN_HOME"];
  return v !== undefined && v !== "" ? v : join(homedir(), ".tkitchen");
}
export function nowIso(clock: Clock): string { return clock.now().toISOString(); }
