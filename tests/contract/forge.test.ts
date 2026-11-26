import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GitHubForge } from "../../modules/forge/adapters.ts";
import type { PullRequest } from "../../modules/forge/index.ts";
import type { RepoConfig } from "../../modules/config/index.ts";
import { SimForge } from "../sim/doubles/sim-forge.ts";
import { forgeContract, FORGE_REPO } from "./forge.contract.ts";
import type { ScriptedForge } from "./forge.contract.ts";

const FAKE_GH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "fake-gh");

class SimScriptedForge extends SimForge implements ScriptedForge {
  open(pr: PullRequest): void {
    const created = this.openPullRequest({
      head: pr.head,
      base: pr.base,
      crossRepository: pr.crossRepository,
      author: pr.author,
    });
    created.number = pr.number;
    created.url = pr.url;
    const all = this.openPullRequests();
    void all;
  }
  dispose(): void {
    return;
  }
}

class FakeGhForge implements ScriptedForge {
  private readonly inner = new GitHubForge();
  private readonly dir: string;
  private readonly prsFile: string;
  private readonly saved: { path: string | undefined; prsFile: string | undefined; fail: string | undefined };
  private prs: PullRequest[] = [];
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "tkitchen-fakegh-"));
    this.prsFile = join(this.dir, "prs.json");
    writeFileSync(this.prsFile, "[]");
    this.saved = {
      path: process.env["PATH"],
      prsFile: process.env["FAKE_GH_PRS_FILE"],
      fail: process.env["FAKE_GH_FAIL"],
    };
    process.env["PATH"] = FAKE_GH_DIR + delimiter + (this.saved.path ?? "");
    process.env["FAKE_GH_PRS_FILE"] = this.prsFile;
    delete process.env["FAKE_GH_FAIL"];
  }
  open(pr: PullRequest): void {
    this.prs.push(pr);
    writeFileSync(
      this.prsFile,
      JSON.stringify(
        this.prs.map((p) => ({
          number: p.number,
          headRefName: p.head,
          baseRefName: p.base,
          url: p.url,
          author: { login: p.author },
          isCrossRepository: p.crossRepository,
        })),
      ),
    );
  }
  failNext(): void {
    process.env["FAKE_GH_FAIL"] = "1";
  }
  listOpenPullRequests(repo: RepoConfig): Promise<PullRequest[]> {
    return this.inner.listOpenPullRequests({ ...repo, path: this.dir });
  }
  dispose(): void {
    if (this.saved.path === undefined) delete process.env["PATH"];
    else process.env["PATH"] = this.saved.path;
    if (this.saved.prsFile === undefined) delete process.env["FAKE_GH_PRS_FILE"];
    else process.env["FAKE_GH_PRS_FILE"] = this.saved.prsFile;
    if (this.saved.fail === undefined) delete process.env["FAKE_GH_FAIL"];
    else process.env["FAKE_GH_FAIL"] = this.saved.fail;
    rmSync(this.dir, { recursive: true, force: true });
  }
}

forgeContract("SimForge", () => new SimScriptedForge());
forgeContract("GitHubForge with fake gh", () => new FakeGhForge());
void FORGE_REPO;
