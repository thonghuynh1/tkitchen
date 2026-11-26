import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepoImpl } from "../../modules/git/adapters.ts";
import { SeededIds } from "../sim/world/rng.ts";
import { SimRemote } from "../sim/doubles/sim-remote.ts";
import { git } from "../helpers.ts";
import { gitRepoContract } from "./git-repo.contract.ts";
import type { ScriptedGitRepo } from "./git-repo.contract.ts";

class SimScriptedRepo extends SimRemote implements ScriptedGitRepo {
  constructor() {
    super(new SeededIds(), { onPortCall: () => Promise.resolve() });
    const root = this.createCommit([]);
    this.initBranch("main", root);
    this.defaultBranch = "main";
  }
  advance(branch: string): Promise<string> { return Promise.resolve(this.commitOn(branch)); }
  branchFrom(name: string, fromBranch: string): Promise<void> { this.createBranch(name, fromBranch); return Promise.resolve(); }
  branchLocalNamed(name: string, fromBranch: string): Promise<void> { this.createBranch(name, fromBranch); return Promise.resolve(); }
  branchLocalCommit(name: string, fromBranch: string): Promise<string> {
    const oid = this.head(fromBranch);
    if (oid === undefined) throw new Error("unknown branch " + fromBranch);
    this.createBranchFromCommit(name, oid);
    return Promise.resolve(oid);
  }
  branchOtherMachine(name: string, fromBranch: string): Promise<void> { this.createBranchOtherMachine(name, fromBranch); return Promise.resolve(); }
  dispose(): Promise<void> { return Promise.resolve(); }
}

class RealScriptedRepo implements ScriptedGitRepo {
  private readonly impl: GitRepoImpl;
  private readonly editor: string;
  private readonly root: string;
  private readonly work: string;
  private counter = 0;
  constructor(impl: GitRepoImpl, editor: string, root: string, work: string) { this.impl = impl; this.editor = editor; this.root = root; this.work = work; }
  lsRemoteHeads(remote: string): ReturnType<GitRepoImpl["lsRemoteHeads"]> { return this.impl.lsRemoteHeads(remote); }
  fetch(remote: string): Promise<void> { return this.impl.fetch(remote); }
  isAncestor(ancestor: string, descendant: string): Promise<boolean> { return this.impl.isAncestor(ancestor, descendant); }
  containingBranches(remote: string, branch: string): Promise<string[]> { return this.impl.containingBranches(remote, branch); }
  countBehind(child: string, base: string): Promise<number> { return this.impl.countBehind(child, base); }
  creationReflog(branch: string): ReturnType<GitRepoImpl["creationReflog"]> { return this.impl.creationReflog(branch); }
  tipAt(ref: string, unixSeconds: number): Promise<string | null> { return this.impl.tipAt(ref, unixSeconds); }
  async advance(branch: string): Promise<string> {
    this.counter += 1;
    await git(this.editor, "fetch", "origin");
    await git(this.editor, "checkout", "-B", branch, "origin/" + branch);
    appendFileSync(join(this.editor, "file.txt"), "advance-" + this.counter + "\n");
    await git(this.editor, "add", ".");
    await git(this.editor, "commit", "-m", "advance-" + this.counter);
    await git(this.editor, "push", "origin", branch);
    const oid = await git(this.editor, "rev-parse", "HEAD");
    return oid.trim();
  }
  async branchFrom(name: string, fromBranch: string): Promise<void> {
    await git(this.editor, "fetch", "origin");
    await git(this.editor, "push", "origin", "origin/" + fromBranch + ":refs/heads/" + name);
  }
  async branchLocalNamed(name: string, fromBranch: string): Promise<void> {
    await git(this.work, "fetch", "origin");
    await git(this.work, "branch", name, "origin/" + fromBranch);
    await git(this.work, "push", "origin", name);
  }
  async branchLocalCommit(name: string, fromBranch: string): Promise<string> {
    await git(this.work, "fetch", "origin");
    const oid = (await git(this.work, "rev-parse", "origin/" + fromBranch)).trim();
    await git(this.work, "branch", name, oid);
    await git(this.work, "push", "origin", name);
    return oid;
  }
  async branchOtherMachine(name: string, fromBranch: string): Promise<void> { await this.branchFrom(name, fromBranch); }
  dispose(): Promise<void> { rmSync(this.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); return Promise.resolve(); }
}

async function makeReal(): Promise<ScriptedGitRepo> {
  const root = mkdtempSync(join(tmpdir(), "tkitchen-contract-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  const editor = join(root, "editor");
  await git(root, "init", "--bare", "-b", "main", origin);
  await git(root, "init", "-b", "main", work);
  await git(work, "config", "user.email", "t@t.t");
  await git(work, "config", "user.name", "T");
  await git(work, "config", "commit.gpgsign", "false");
  writeFileSync(join(work, "file.txt"), "root\n");
  await git(work, "add", ".");
  await git(work, "commit", "-m", "root");
  await git(work, "remote", "add", "origin", origin);
  await git(work, "push", "-u", "origin", "main");
  await git(root, "clone", origin, editor);
  await git(editor, "config", "user.email", "t@t.t");
  await git(editor, "config", "user.name", "T");
  await git(editor, "config", "commit.gpgsign", "false");
  const repo = new RealScriptedRepo(new GitRepoImpl(work), editor, root, work);
  await repo.fetch("origin");
  return repo;
}

async function makeSim(): Promise<ScriptedGitRepo> {
  const repo = new SimScriptedRepo();
  await repo.fetch("origin");
  return repo;
}

gitRepoContract("SimRemote", makeSim);
gitRepoContract("real git", makeReal);
