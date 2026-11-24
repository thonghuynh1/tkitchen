import { createHash } from "node:crypto";
import { link, mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Lock } from "../application/ports.ts";
import { kitchenHome } from "./env.ts";

const MAX_ACQUIRE_ATTEMPTS = 100;
const LOCK_WRITE_GRACE_MS = 1000;
const GUARD_RETRY_MS = 10;
const DIGEST_HEX_LENGTH = 16;

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

async function readTicketPidAt(path: string): Promise<number | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const plain = parsePid(raw);
  if (plain !== null) return plain;
  return readPidFromRaw(raw);
}

async function readPidFromRaw(raw: string): Promise<number | null> {
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

interface LockIdentity {
  pid: number | null;
  key: string;
}

interface TicketSnapshot {
  pid: number | null;
  key: string;
}

async function readIdentityAt(path: string): Promise<LockIdentity | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let info;
  try {
    info = await stat(path);
  } catch {
    return null;
  }
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, DIGEST_HEX_LENGTH);
  const key = [info.ino, info.mtimeMs, info.size, digest].join("-");
  return { pid: await readPidFromRaw(raw), key };
}

async function readTicketSnapshotAt(path: string): Promise<TicketSnapshot | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let info;
  try {
    info = await stat(path);
  } catch {
    return null;
  }
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, DIGEST_HEX_LENGTH);
  const key = [info.ino, info.mtimeMs, info.size, digest].join("-");
  const plain = parsePid(raw);
  return { pid: plain !== null ? plain : await readPidFromRaw(raw), key };
}

type TakeoverResult = "acquired" | "held" | "retry";

export class FileLock implements Lock {
  readonly path: string;
  private readonly claimPath: string;
  private readonly publishPath: string;
  private readonly takeoverPath: string;
  private readonly takeoverPublishPath: string;
  private readonly pid: number;
  constructor(home?: string) {
    this.path = join(home ?? kitchenHome(), "kitchen.lock");
    this.pid = process.pid;
    this.claimPath = this.path + ".claim-" + this.pid;
    this.publishPath = this.path + ".publish-" + this.pid;
    this.takeoverPath = this.path + ".takeover";
    this.takeoverPublishPath = this.path + ".takeover-publish-" + this.pid;
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
  private async clearDeadTicket(path: string): Promise<void> {
    const judged = await readTicketSnapshotAt(path);
    if (judged === null) return;
    if (judged.pid !== null && pidIsAlive(judged.pid)) return;
    if (judged.pid === null && await isFresh(path)) return;
    const recoveryPath = path + ".recover-" + (judged.pid === null ? "invalid-" + judged.key : String(judged.pid));
    const recoveryPublishPath = recoveryPath + ".publish-" + this.pid;
    if (!await this.publish(recoveryPath, String(this.pid), recoveryPublishPath)) {
      const recoveryPid = await readTicketPidAt(recoveryPath);
      if (recoveryPid !== null && pidIsAlive(recoveryPid)) return;
      if (recoveryPid === null && await isFresh(recoveryPath)) return;
      await this.clearDeadTicket(recoveryPath);
      return;
    }
    try {
      const now = await readTicketSnapshotAt(path);
      if (now === null || now.key !== judged.key) return;
      await discardAny(path);
    } finally {
      await discardAt(recoveryPath);
    }
  }
  private async takeOverStale(judged: LockIdentity): Promise<TakeoverResult> {
    const content = JSON.stringify({ pid: this.pid, key: judged.key });
    if (!await this.publish(this.takeoverPath, content, this.takeoverPublishPath)) {
      await this.clearDeadTicket(this.takeoverPath);
      return "retry";
    }
    try {
      const now = await readIdentityAt(this.path);
      if (now !== null && now.key !== judged.key) {
        return now.pid !== null && pidIsAlive(now.pid) ? "held" : "retry";
      }
      if (now !== null) await discardAt(this.path);
      if (await this.tryCreate()) return "acquired";
      const holder = await readIdentityAt(this.path);
      return holder !== null && holder.pid !== null && pidIsAlive(holder.pid) ? "held" : "retry";
    } finally {
      if (await readTicketPidAt(this.takeoverPath) === this.pid) await discardAt(this.takeoverPath);
    }
  }
  async acquire(): Promise<"acquired" | "held"> {
    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
      if (await this.tryCreate()) return "acquired";
      const holder = await readIdentityAt(this.path);
      if (holder !== null && holder.pid !== null && pidIsAlive(holder.pid)) return "held";
      if (holder !== null && holder.pid === null && await isFresh(this.path)) return "held";
      if (holder === null) continue;
      const result = await this.takeOverStale(holder);
      if (result !== "retry") return result;
      await delay(GUARD_RETRY_MS);
    }
    return "held";
  }
  async release(): Promise<void> {
    if (await readPidAt(this.path) !== this.pid) return;
    if (!await claimTo(this.path, this.claimPath)) return;
    const claimed = await readPidAt(this.claimPath);
    if (claimed === this.pid) {
      await discardAt(this.claimPath);
      return;
    }
    await restoreClaim(this.claimPath, this.path);
  }
}
