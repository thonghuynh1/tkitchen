import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const onWindows = process.platform === "win32";

interface Result { stdout: string; stderr: string; code: number }

async function powershell(script: string, ...args: string[]): Promise<Result> {
  try {
    const r = await run("powershell", ["-NoProfile", "-File", script, ...args]);
    return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: 0 };
  } catch (e) {
    const err = e as { stdout?: unknown; stderr?: unknown; code?: unknown };
    return { stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? ""), code: typeof err.code === "number" ? err.code : 1 };
  }
}

async function schtasksQuery(taskName: string): Promise<Result> {
  try {
    const r = await run("schtasks", ["/Query", "/TN", taskName]);
    return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: 0 };
  } catch (e) {
    const err = e as { stdout?: unknown; stderr?: unknown; code?: unknown };
    return { stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? ""), code: typeof err.code === "number" ? err.code : 1 };
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

function element(xml: string, name: string): string {
  const match = new RegExp("<" + name + ">([^<]*)</" + name + ">").exec(xml);
  if (match === null || match[1] === undefined) throw new Error("missing element " + name + " in task XML");
  return decodeXml(match[1]);
}

describe.skipIf(!onWindows)("deploy/windows scheduled task", () => {
  it("export writes the task XML without registering", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-install-task-"));
    const exportPath = join(dir, "task.xml");
    const result = await powershell("deploy/windows/install-task.ps1", "-Export", exportPath, "-TaskName", "tkitchen-test");
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(existsSync(exportPath)).toBe(true);
    const xml = readFileSync(exportPath, "utf8");
    expect((xml.match(/<LogonTrigger>/g) ?? []).length).toBe(1);
    expect(xml).not.toContain("BootTrigger");
    expect(element(xml, "UserId")).toBe(process.env["USERDOMAIN"] + "\\" + process.env["USERNAME"]);
    expect(element(xml, "LogonType")).toBe("InteractiveToken");
    expect(element(xml, "RunLevel")).toBe("LeastPrivilege");
    expect(element(xml, "Command").endsWith("node.exe")).toBe(true);
    expect(element(xml, "Arguments").endsWith('src\\cli\\tkitchen.ts" serve')).toBe(true);
    expect(element(xml, "MultipleInstancesPolicy")).toBe("IgnoreNew");
    expect(element(xml, "ExecutionTimeLimit")).toBe("PT0S");
    const query = await schtasksQuery("tkitchen-test");
    expect(query.code).not.toBe(0);
  }, 60000);

  it("uninstall without a task succeeds", async () => {
    const before = await powershell("deploy/windows/uninstall-task.ps1", "-TaskName", "tkitchen-test");
    expect(before.code, before.stdout + before.stderr).toBe(0);
    const again = await powershell("deploy/windows/uninstall-task.ps1", "-TaskName", "tkitchen-test");
    expect(again.code, again.stdout + again.stderr).toBe(0);
  }, 60000);
});
