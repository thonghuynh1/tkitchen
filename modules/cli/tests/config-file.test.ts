import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli } from "../../testing/adapters.ts";

describe("config file", () => {
  it("missing file exits 2 naming the path and writes no db", async () => {
    const home = mkdtempSync(join(tmpdir(), "tk-home-"));
    const r = await cli(home, "round", "--repo", "x");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(join(home, "config.json"));
    expect(existsSync(join(home, "kitchen.db"))).toBe(false);
  });
  it("non-git repo path exits 2 naming repos[0].path and writes no db", async () => {
    const home = mkdtempSync(join(tmpdir(), "tk-home-"));
    const notRepo = mkdtempSync(join(tmpdir(), "tk-notrepo-"));
    writeFileSync(join(home, "config.json"), JSON.stringify({ repos: [{ name: "x", path: notRepo }] }));
    const r = await cli(home, "round", "--repo", "x");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("repos[0].path");
    expect(existsSync(join(home, "kitchen.db"))).toBe(false);
  });
});
