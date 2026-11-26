import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGhRunner } from "../adapters.ts";
import { PortError } from "../../platform/index.ts";

const KILL_WAIT_MS = 10000;
const KILL_STEP_MS = 100;
const FAKE_GH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "fake-gh");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("gh runner timeout", () => {
  it("kills the whole gh process tree and reports a timeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-gh-timeout-"));
    const pidFile = join(dir, "gh.pid");
    const saved = {
      path: process.env["PATH"],
      sleep: process.env["FAKE_GH_SLEEP_MS"],
      pid: process.env["FAKE_GH_PID_FILE"],
    };
    process.env["PATH"] = FAKE_GH_DIR + delimiter + (saved.path ?? "");
    process.env["FAKE_GH_SLEEP_MS"] = "30000";
    process.env["FAKE_GH_PID_FILE"] = pidFile;
    try {
      const started = Date.now();
      const error: unknown = await createGhRunner({ timeoutMs: 1500 })(["pr", "list"], dir).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(PortError);
      expect(error instanceof PortError ? error.kind : null).toBe("timeout");
      expect(Date.now() - started).toBeLessThan(5000);
      expect(existsSync(pidFile)).toBe(true);
      const pid = Number(readFileSync(pidFile, "utf8"));
      const killDeadline = Date.now() + KILL_WAIT_MS;
      while (alive(pid) && Date.now() < killDeadline) {
        await new Promise((resolve) => {
          setTimeout(resolve, KILL_STEP_MS);
        });
      }
      expect(alive(pid)).toBe(false);
    } finally {
      process.env["PATH"] = saved.path;
      if (saved.sleep === undefined) delete process.env["FAKE_GH_SLEEP_MS"];
      else process.env["FAKE_GH_SLEEP_MS"] = saved.sleep;
      if (saved.pid === undefined) delete process.env["FAKE_GH_PID_FILE"];
      else process.env["FAKE_GH_PID_FILE"] = saved.pid;
    }
  }, 15000);
});
