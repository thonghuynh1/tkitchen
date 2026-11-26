import type { Lock } from "../../modules/lock/index.ts";

export class SimLockSystem {
  private holder: number | null = null;
  private readonly alive = new Set<number>();
  private readonly activeWriters = new Set<number>();
  maxActiveWriters = 0;
  register(pid: number): void {
    this.alive.add(pid);
  }
  kill(pid: number): void {
    this.alive.delete(pid);
    this.activeWriters.delete(pid);
  }
  isAlive(pid: number): boolean {
    return this.alive.has(pid);
  }
  holderPid(): number | null {
    return this.holder;
  }
  tryAcquire(pid: number): boolean {
    if (this.holder !== null && this.holder !== pid && this.alive.has(this.holder)) return false;
    this.holder = pid;
    this.activeWriters.add(pid);
    if (this.activeWriters.size > this.maxActiveWriters) this.maxActiveWriters = this.activeWriters.size;
    return true;
  }
  release(pid: number): void {
    if (!this.alive.has(pid)) return;
    this.activeWriters.delete(pid);
    if (this.holder === pid) this.holder = null;
  }
}

export class SimLock implements Lock {
  private readonly system: SimLockSystem;
  private readonly pid: number;
  constructor(system: SimLockSystem, pid: number) {
    this.system = system;
    this.pid = pid;
    this.system.register(pid);
  }
  acquire(): Promise<"acquired" | "held"> {
    return Promise.resolve(this.system.tryAcquire(this.pid) ? "acquired" : "held");
  }
  release(): Promise<void> {
    this.system.release(this.pid);
    return Promise.resolve();
  }
  holderPid(): Promise<number | null> {
    return Promise.resolve(this.system.holderPid());
  }
  crash(): void {
    this.system.kill(this.pid);
  }
}
