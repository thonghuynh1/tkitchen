import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Lock } from "../application/ports.ts";
import { kitchenHome } from "./env.ts";

const MAX_ACQUIRE_ATTEMPTS = 3;
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

export class FileLock implements Lock {
  readonly path: string;
  private readonly pid: number;
  constructor(home?: string) {
    this.path = join(home ?? kitchenHome(), "kitchen.lock");
    this.pid = process.pid;
  }
  private async readHolderPid(): Promise<number | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
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
  holderPid(): Promise<number | null> {
    return this.readHolderPid();
  }
  private async tryCreate(): Promise<boolean> {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const content = JSON.stringify({ pid: this.pid, startedAt: new Date().toISOString() });
      await writeFile(this.path, content, { flag: "wx" });
      return true;
    } catch (e) {
      if (errorCode(e) === "EEXIST") return false;
      throw e;
    }
  }
  async acquire(): Promise<"acquired" | "held"> {
    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
      if (await this.tryCreate()) return "acquired";
      const holder = await this.readHolderPid();
      if (holder !== null && pidIsAlive(holder)) return "held";
      if (holder === null) {
        try {
          const info = await stat(this.path);
          if (Date.now() - info.mtimeMs < LOCK_WRITE_GRACE_MS) return "held";
        } catch (e) {
          if (errorCode(e) === "ENOENT") continue;
          throw e;
        }
      }
      try {
        await unlink(this.path);
      } catch (e) {
        if (errorCode(e) !== "ENOENT") throw e;
      }
    }
    return "held";
  }
  async release(): Promise<void> {
    const holder = await this.readHolderPid();
    if (holder !== this.pid) return;
    try {
      await unlink(this.path);
    } catch (e) {
      if (errorCode(e) !== "ENOENT") throw e;
    }
  }
}
