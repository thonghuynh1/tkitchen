import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const onWindows = process.platform === "win32";

interface Result {
  stdout: string;
  stderr: string;
  code: number;
}

async function powershell(script: string, ...args: string[]): Promise<Result> {
  try {
    const r = await run("powershell", ["-NoProfile", "-File", script, ...args]);
    return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: 0 };
  } catch (e) {
    const err = e as { stdout?: unknown; stderr?: unknown; code?: unknown };
    return {
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
      code: typeof err.code === "number" ? err.code : 1,
    };
  }
}

async function schtasksQuery(taskName: string): Promise<Result> {
  try {
    const r = await run("schtasks", ["/Query", "/TN", taskName]);
    return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: 0 };
  } catch (e) {
    const err = e as { stdout?: unknown; stderr?: unknown; code?: unknown };
    return {
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
      code: typeof err.code === "number" ? err.code : 1,
    };
  }
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function elements(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp("<" + name + ">([^<]*)</" + name + ">", "g"))].map((m) => decodeXml(m[1] ?? ""));
}

function element(xml: string, name: string): string {
  const match = new RegExp("<" + name + ">([^<]*)</" + name + ">").exec(xml);
  if (match === null || match[1] === undefined) throw new Error("missing element " + name + " in task XML");
  return decodeXml(match[1]);
}

const taskName = "tkitchen-test-" + process.pid;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe.skipIf(!onWindows)("deploy/windows scheduled task", () => {
  it("export writes the task XML without registering", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-install-task-"));
    const exportPath = join(dir, "task.xml");
    const result = await powershell("deploy/windows/install-task.ps1", "-Export", exportPath, "-TaskName", taskName);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(existsSync(exportPath)).toBe(true);
    const xml = readFileSync(exportPath, "utf8");
    expect((xml.match(/<LogonTrigger>/g) ?? []).length).toBe(1);
    expect(xml).not.toContain("BootTrigger");
    expect(elements(xml, "UserId")).toEqual([
      process.env["USERDOMAIN"] + "\\" + process.env["USERNAME"],
      process.env["USERDOMAIN"] + "\\" + process.env["USERNAME"],
    ]);
    expect(element(xml, "LogonType")).toBe("InteractiveToken");
    expect(element(xml, "RunLevel")).toBe("LeastPrivilege");
    expect(element(xml, "Command").endsWith("node.exe")).toBe(true);
    expect(element(xml, "Arguments").endsWith('cli\\tkitchen.ts" serve')).toBe(true);
    expect(element(xml, "MultipleInstancesPolicy")).toBe("IgnoreNew");
    expect(element(xml, "ExecutionTimeLimit")).toBe("PT0S");
    expect(element(xml, "Interval")).toBe("PT1M");
    expect(element(xml, "Count")).toBe("3");
    expect(element(xml, "WorkingDirectory")).toBe(repoRoot);
    try {
      const query = await schtasksQuery(taskName);
      expect(query.code).not.toBe(0);
    } finally {
      await powershell("deploy/windows/uninstall-task.ps1", "-TaskName", taskName);
    }
  }, 60000);

  it("failed install exits non-zero and does not print Registered", async () => {
    const result = await powershell("deploy/windows/install-task.ps1", "-TaskName", "bad<name");
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain("Registered task");
    const query = await schtasksQuery("bad<name");
    expect(query.code).not.toBe(0);
  }, 60000);

  it("failed export exits non-zero and does not print Exported", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-install-task-"));
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "");
    const exportPath = join(blocker, "task.xml");
    const result = await powershell("deploy/windows/install-task.ps1", "-Export", exportPath, "-TaskName", taskName);
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain("Exported task definition");
    expect(existsSync(exportPath)).toBe(false);
  }, 60000);

  it("uninstall without a task succeeds", async () => {
    const before = await powershell("deploy/windows/uninstall-task.ps1", "-TaskName", taskName);
    expect(before.code, before.stdout + before.stderr).toBe(0);
    const again = await powershell("deploy/windows/uninstall-task.ps1", "-TaskName", taskName);
    expect(again.code, again.stdout + again.stderr).toBe(0);
  }, 60000);
});
