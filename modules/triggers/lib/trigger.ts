import { createHash } from "node:crypto";

export interface BaseMovedMeta { base: string; oldHead: string; newHead: string; }
export interface Trigger {
  id: string; source: string; threads: string[]; actor: string; human: boolean;
  addressed: string | null; at: string; text: string | null; channel: string | null;
  url: string | null; machine: string; meta: BaseMovedMeta;
}
export function triggerId(repo: string, base: string, newHead: string): string {
  return createHash("sha256").update("git-base\0" + repo + "\0" + base + "\0" + newHead, "utf8").digest("hex");
}
export function threadFor(repo: string, branch: string): string { return "git:" + repo + ":" + branch; }
export function baseMovedTrigger(input: { repo: string; base: string; oldHead: string; newHead: string; children: string[]; at: string; machine: string; }): Trigger {
  const threads = [...input.children].sort().map((c) => threadFor(input.repo, c));
  return { id: triggerId(input.repo, input.base, input.newHead), source: "git", threads, actor: "git", human: false, addressed: null, at: input.at, text: null, channel: null, url: null, machine: input.machine, meta: { base: input.base, oldHead: input.oldHead, newHead: input.newHead } };
}
