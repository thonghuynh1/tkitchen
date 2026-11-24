import { link, mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Lock } from "../application/ports.ts";
import { kitchenHome } from "./env.ts";

const MAX_ACQUIRE_ATTEMPTS = 100;
const LOCK_WRITE_GRACE_MS = 1000;
const GUARD_RETRY_MS = 10;

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

function parsePid(raw: string): number | null {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

async function readGuardPidAt(path: string): Promise<number | null> {
  try {
    return parsePid(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function discardAny(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

async function claimTo(from: string, to: string): Promise<boolean> {
  await discardAny(to);
  try {
    await rename(from, to);
    return true;
  } catch (e) {
    if (errorCode(e) === "ENOENT") return false;
    throw e;
  }
}

async function restoreClaim(claim: string, target: string): Promise<void> {
  try {
    await link(claim, target);
  } catch (e) {
    if (errorCode(e) !== "EEXIST") throw e;
  }
  await unlink(claim);
}

async function discardAt(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (e) {
    if (errorCode(e) !== "ENOENT") throw e;
  }
}

async function isFresh(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return Date.now() - info.mtimeMs < LOCK_WRITE_GRACE_MS;
  } catch (e) {
    if (errorCode(e) === "ENOENT") return false;
    throw e;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

type TakeoverResult = "acquired" | "held" | "retry";

export class FileLock implements Lock {
  readonly path: string;
  private readonly claimPath: string;
  private readonly publishPath: string;
  private readonly guardPath: string;
  private readonly guardClaimPath: string;
  private readonly guardPublishPath: string;
  private readonly pid: number;
  constructor(home?: string) {
    this.path = join(home ?? kitchenHome(), "kitchen.lock");
    this.pid = process.pid;
    this.claimPath = this.path + ".claim-" + this.pid;
    this.publishPath = this.path + ".publish-" + this.pid;
    this.guardPath = this.path + ".guard";
    this.guardClaimPath = this.path + ".guard-claim-" + this.pid;
    this.guardPublishPath = this.path + ".guard-publish-" + this.pid;
  }
  holderPid(): Promise<number | null> {
    return readPidAt(this.path);
  }
  private async publish(target: string, content: string, publishPath: string): Promise<boolean> {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(publishPath, content);
    try {
      await link(publishPath, target);
      return true;
    } catch (e) {
      if (errorCode(e) === "EEXIST") return false;
      throw e;
    } finally {
      await unlink(publishPath).catch(() => undefined);
    }
  }
  private async tryCreate(): Promise<boolean> {
    const content = JSON.stringify({ pid: this.pid, startedAt: new Date().toISOString() });
    return this.publish(this.path, content, this.publishPath);
  }
  private async enterGuard(): Promise<boolean> {
    let published = false;
    try {
      published = await this.publish(this.guardPath, String(this.pid), this.guardPublishPath);
    } catch (e) {
      if (errorCode(e) !== "EPERM" && errorCode(e) !== "EEXIST") throw e;
    }
    if (published) return true;
    await this.recoverGuard();
    return false;
  }
  private async recoverGuard(): Promise<void> {
    const guardPid = await readGuardPidAt(this.guardPath);
    if (guardPid !== null && pidIsAlive(guardPid)) return;
    if (guardPid === null && await isFresh(this.guardPath)) return;
    if (!await claimTo(this.guardPath, this.guardClaimPath)) return;
    const claimed = await readGuardPidAt(this.guardClaimPath);
    if (claimed !== null && pidIsAlive(claimed)) {
      await restoreClaim(this.guardClaimPath, this.guardPath);
      return;
    }
    await discardAny(this.guardClaimPath);
  }
  private async exitGuard(): Promise<void> {
    if (!await claimTo(this.guardPath, this.guardClaimPath)) return;
    const claimed = await readGuardPidAt(this.guardClaimPath);
    if (claimed === this.pid) {
      await discardAny(this.guardClaimPath);
      return;
    }
    await restoreClaim(this.guardClaimPath, this.guardPath);
  }
  private async takeOverStale(): Promise<TakeoverResult> {
    if (!await this.enterGuard()) return "retry";
    try {
      const holder = await readPidAt(this.path);
      if (holder !== null && pidIsAlive(holder)) return "held";
      if (holder === null && await isFresh(this.path)) return "held";
      await discardAt(this.path);
      if (await this.tryCreate()) return "acquired";
      const now = await readPidAt(this.path);
      return now !== null && pidIsAlive(now) ? "held" : "retry";
    } finally {
      await this.exitGuard();
    }
  }
  async acquire(): Promise<"acquired" | "held"> {
    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
      if (await this.tryCreate()) return "acquired";
      const holder = await readPidAt(this.path);
      if (holder !== null && pidIsAlive(holder)) return "held";
      if (holder === null && await isFresh(this.path)) return "held";
      const result = await this.takeOverStale();
      if (result !== "retry") return result;
      await delay(GUARD_RETRY_MS);
    }
    return "held";
  }
  async release(): Promise<void> {
    if (!await claimTo(this.path, this.claimPath)) return;
    const claimed = await readPidAt(this.claimPath);
    if (claimed === this.pid) {
      await discardAt(this.claimPath);
      return;
    }
    await restoreClaim(this.claimPath, this.path);
  }
}
