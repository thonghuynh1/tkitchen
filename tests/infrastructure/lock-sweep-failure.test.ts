import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readdir: async () => { throw Object.assign(new Error("EACCES: permission denied, scandir"), { code: "EACCES" }); } };
});

const { FileLock } = await import("../../src/infrastructure/lock-file.ts");

describe("FileLock sweep failure", () => {
  it("a failing sweep of recovery tickets does not undo a successful acquire", async () => {
    const lock = new FileLock(mkdtempSync(join(tmpdir(), "tk-lock-sweep-")));
    expect(await lock.acquire()).toBe("acquired");
    expect(await lock.holderPid()).toBe(process.pid);
    await lock.release();
  });
});
