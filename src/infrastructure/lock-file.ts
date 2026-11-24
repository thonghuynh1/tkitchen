import { link, mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Lock } from "../application/ports.ts";
import { kitchenHome } from "./env.ts";

const MAX_ACQUIRE_ATTEMPTS = 100;
const LOCK_WRITE_GRACE_MS = 1000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errorCode(e: unknown): string | null {
  if (e instanceof Error && "code" in e && typeof e.code === "string") return e.code;
  return null;
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return errorCode(e) !== "ESRCH";
  }
}

async function readPidAt(path: string): Promise<number | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const pid = parsed["pid"];
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null;
}

type TakeoverResult = "acquired" | "held" | "retry";

export class FileLock implements Lock {
  readonly path: string;
  private readonly claimPath: string;
  private readonly publishPath: string;
  private readonly guardPath: string;
  private readonly guardClaimPath: string;
  private readonly pid: number;
  constructor(home?: string) {
    this.path = join(home ?? kitchenHome(), "kitchen.lock");
    this.pid = process.pid;
    this.claimPath = this.path + ".claim-" + this.pid;
    this.publishPath = this.path + ".publish-" + this.pid;
    this.guardPath = this.path + ".guard";
    this.guardClaimPath = this.path + ".guard-claim-" + this.pid;
  }
  holderPid(): Promise<number | null> {
    return readPidAt(this.path);
  }
  private async tryCreate(): Promise<boolean> {
    await mkdir(dirname(this.path), { recursive: true });
    const content = JSON.stringify({ pid: this.pid, startedAt: new Date().toISOString() });
    await writeFile(this.publishPath, content);
    try {
      await link(this.publishPath, this.path);
      return true;
    } catch (e) {
      if (errorCode(e) === "EEXIST") return false;
      throw e;
    } finally {
      await unlink(this.publishPath).catch(() => undefined);
    }
  }
  private async claimLockFile(): Promise<boolean> {
    try {
      await unlink(this.claimPath);
    } catch (e) {
      if (errorCode(e) !== "ENOENT") throw e;
    }
    try {
      await rename(this.path, this.claimPath);
      return true;
    } catch (e) {
      if (errorCode(e) === "ENOENT") return false;
      throw e;
    }
  }
  private async restoreClaimedLockFile(): Promise<void> {
    try {
      await link(this.claimPath, this.path);
    } catch (e) {
      if (errorCode(e) !== "EEXIST") throw e;
    }
    await unlink(this.claimPath);
  }
  private async discardClaimedLockFile(): Promise<void> {
    try {
      await unlink(this.claimPath);
    } catch (e) {
      if (errorCode(e) !== "ENOENT") throw e;
    }
  }
  private guardPidPath(): string { return join(this.guardPath, "pid"); }
  private async enterGuard(): Promise<boolean> {
    try {
      await mkdir(this.guardPath);
    } catch (e) {
      if (errorCode(e) !== "EEXIST") throw e;
      await this.recoverDeadGuard();
      return false;
    }
    await writeFile(this.guardPidPath(), String(this.pid));
    return true;
  }
  private async recoverDeadGuard(): Promise<void> {
    let guardPid: number | null = null;
    try {
      const raw = await readFile(this.guardPidPath(), "utf8");
      const parsed = Number.parseInt(raw.trim(), 10);
      guardPid = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } catch {
      return;
    }
    if (guardPid === null || pidIsAlive(guardPid)) return;
    try {
      await rename(this.guardPath, this.guardClaimPath);
    } catch {
      return;
    }
    let claimedPid: number | null = null;
    try {
      const raw = await readFile(join(this.guardClaimPath, "pid"), "utf8");
      const parsed = Number.parseInt(raw.trim(), 10);
      claimedPid = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } catch {
      claimedPid = null;
    }
    if (claimedPid !== null && pidIsAlive(claimedPid)) {
      try {
        await rename(this.guardClaimPath, this.guardPath);
      } catch {
        await rm(this.guardClaimPath, { recursive: true, force: true });
      }
      return;
    }
    await rm(this.guardClaimPath, { recursive: true, force: true });
  }
  private async exitGuard(): Promise<void> {
    await rm(this.guardPath, { recursive: true, force: true });
  }
  private async takeOverStale(): Promise<TakeoverResult> {
    if (!await this.enterGuard()) return "retry";
    try {
      const holder = await readPidAt(this.path);
      if (holder !== null && pidIsAlive(holder)) return "held";
      if (holder === null && await this.freshUnparseableLockIsHeld()) return "held";
      try {
        await unlink(this.path);
      } catch (e) {
        if (errorCode(e) !== "ENOENT") throw e;
      }
      if (await this.tryCreate()) return "acquired";
      const now = await readPidAt(this.path);
      return now !== null && pidIsAlive(now) ? "held" : "retry";
    } finally {
      await this.exitGuard();
    }
  }
  private async freshUnparseableLockIsHeld(): Promise<boolean> {
    try {
      const info = await stat(this.path);
      return Date.now() - info.mtimeMs < LOCK_WRITE_GRACE_MS;
    } catch (e) {
      if (errorCode(e) === "ENOENT") return false;
      throw e;
    }
  }
  async acquire(): Promise<"acquired" | "held"> {
    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
      if (await this.tryCreate()) return "acquired";
      const holder = await readPidAt(this.path);
      if (holder !== null && pidIsAlive(holder)) return "held";
      if (holder === null && await this.freshUnparseableLockIsHeld()) return "held";
      const result = await this.takeOverStale();
      if (result !== "retry") return result;
    }
    return "held";
  }
  async release(): Promise<void> {
    if (!await this.claimLockFile()) return;
    const claimed = await readPidAt(this.claimPath);
    if (claimed === this.pid) {
      await this.discardClaimedLockFile();
      return;
    }
    await this.restoreClaimedLockFile();
  }
}
