import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cruise } from "dependency-cruiser";
import { describe, expect, it } from "vitest";

type Tree = Readonly<Record<string, string>>;
interface Violation {
  rule: { name: string };
  from: string;
  to: string;
}
interface Config {
  forbidden: unknown[];
  options: Record<string, unknown>;
}

const config = createRequire(import.meta.url)("../../.dependency-cruiser.cjs") as Config;

const CLEAN: Tree = {
  "modules/git/lib/contract.ts": "export interface GitRepo { fetch(): Promise<void>; }\n",
  "modules/git/lib/adapters/git-repo.ts":
    'import { spawn } from "node:child_process";\nimport type { GitRepo } from "../contract.ts";\nexport class GitRepoImpl implements GitRepo { async fetch(): Promise<void> { void spawn; } }\n',
  "modules/git/index.ts": 'export type { GitRepo } from "./lib/contract.ts";\n',
  "modules/git/adapters.ts": 'export { GitRepoImpl } from "./lib/adapters/git-repo.ts";\n',
  "modules/testing/lib/adapters/helpers.ts": 'export const kitchen = (): string => "ok";\n',
  "modules/testing/adapters.ts": 'export { kitchen } from "./lib/adapters/helpers.ts";\n',
  "modules/git/tests/git.test.ts":
    'import { GitRepoImpl } from "../adapters.ts";\nimport { kitchen } from "../../testing/adapters.ts";\nexport const r = [new GitRepoImpl(), kitchen()];\n',
  "modules/rounds/lib/round.ts":
    'import { createHash } from "node:crypto";\nimport type { GitRepo } from "../../git/index.ts";\nexport const run = (g: GitRepo): unknown => [g, createHash];\n',
  "modules/rounds/index.ts": 'export { run } from "./lib/round.ts";\n',
  "index.ts":
    'import { GitRepoImpl } from "./modules/git/adapters.ts";\nimport { run } from "./modules/rounds/index.ts";\nrun(new GitRepoImpl());\n',
  "modules/cli/lib/parse.ts": 'export const word = "serve";\n',
  "modules/cli/lib/adapters/main.ts":
    'import { GitRepoImpl } from "../../../git/adapters.ts";\nimport { run } from "../../../rounds/index.ts";\nimport { word } from "../parse.ts";\nexport const main = (): unknown => [run(new GitRepoImpl()), word];\n',
  "modules/git/web.ts": 'export const label = "git";\n',
  "src/app.ts": 'import { label } from "../modules/git/web.ts";\nexport const view = label;\n',
};

async function violations(extra: Tree): Promise<Violation[]> {
  const root = mkdtempSync(join(tmpdir(), "tkitchen-seams-"));
  try {
    for (const [path, text] of Object.entries({ ...CLEAN, ...extra })) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const result = await cruise(["modules", "index.ts", "src"], {
      ...config.options,
      baseDir: root,
      validate: true,
      ruleSet: { forbidden: config.forbidden },
    } as never);
    const output = result.output as { summary: { violations: Violation[] } };
    return output.summary.violations;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function rulesHit(extra: Tree): Promise<string[]> {
  return (await violations(extra)).map((v) => v.rule.name);
}

describe("module seams", () => {
  it("a clean module tree passes", async () => {
    expect(await rulesHit({})).toEqual([]);
  });
  it("a module importing another module's lib fails", async () => {
    expect(
      await rulesHit({ "modules/rounds/lib/x.ts": 'export { type GitRepo } from "../../git/lib/contract.ts";\n' }),
    ).toContain("entry-points-only-across-modules");
  });
  it("the package entry importing a module's lib fails", async () => {
    expect(
      await rulesHit({ "index.ts": 'export { GitRepoImpl } from "./modules/git/lib/adapters/git-repo.ts";\n' }),
    ).toContain("entry-points-only-from-outside");
  });
  it("a module's tests importing its own lib fail", async () => {
    expect(
      await rulesHit({ "modules/git/tests/x.test.ts": 'export { GitRepoImpl } from "../lib/adapters/git-repo.ts";\n' }),
    ).toContain("module-tests-through-own-entry");
  });
  it("production code importing its module's tests fails", async () => {
    expect(await rulesHit({ "modules/git/lib/x.ts": 'export { r } from "../tests/git.test.ts";\n' })).toContain(
      "tests-folder-is-private",
    );
  });
  it("a pure lib importing a Node built-in fails", async () => {
    expect(await rulesHit({ "modules/rounds/lib/x.ts": 'export { readFile } from "node:fs/promises";\n' })).toContain(
      "pure-lib-imports-no-node",
    );
  });
  it("a pure lib importing another module's adapters fails", async () => {
    expect(
      await rulesHit({ "modules/rounds/lib/x.ts": 'export { GitRepoImpl } from "../../git/adapters.ts";\n' }),
    ).toContain("pure-lib-imports-no-adapters");
  });
  it("production code importing the testing module fails", async () => {
    expect(await rulesHit({ "index.ts": 'export { kitchen } from "./modules/testing/adapters.ts";\n' })).toContain(
      "testing-only-from-tests",
    );
  });
  it("a module's index exporting its adapters fails", async () => {
    expect(
      await rulesHit({ "modules/git/index.ts": 'export { GitRepoImpl } from "./lib/adapters/git-repo.ts";\n' }),
    ).toContain("index-stays-pure");
  });
  it("a circular import fails", async () => {
    expect(
      await rulesHit({
        "modules/rounds/lib/a.ts": 'import { b } from "./b.ts";\nexport const a = (): unknown => b;\n',
        "modules/rounds/lib/b.ts": 'import { a } from "./a.ts";\nexport const b = (): unknown => a;\n',
      }),
    ).toContain("no-circular");
  });
  it("web code importing a Node built-in fails", async () => {
    expect(await rulesHit({ "src/bad.ts": 'export { readFileSync } from "node:fs";\n' })).toContain(
      "web-never-imports-node",
    );
  });
  it("web code reaching a module index fails", async () => {
    expect(await rulesHit({ "src/bad.ts": 'export { type GitRepo } from "../modules/git/index.ts";\n' })).toContain(
      "web-reaches-modules-through-web-entry-only",
    );
  });
  it("radix outside components/ui fails", async () => {
    expect(await rulesHit({ "src/bad.ts": 'export { Slot } from "@radix-ui/react-slot";\n' })).toContain(
      "radix-only-in-components-ui",
    );
  });
  it("radix inside components/ui passes the radix rule", async () => {
    expect(
      await rulesHit({ "src/components/ui/x.ts": 'export { Slot } from "@radix-ui/react-slot";\n' }),
    ).not.toContain("radix-only-in-components-ui");
  });
  it("an import that resolves nowhere fails", async () => {
    expect(await rulesHit({ "modules/rounds/lib/x.ts": 'export { gone } from "./gone.ts";\n' })).toContain(
      "no-unresolvable-imports",
    );
  });
});
