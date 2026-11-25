import { PortError } from "../../../src/modules/platform/index.ts";

export type GitFaultKind = "timeout" | "failed";
export type GitMethod = "lsRemoteHeads" | "fetch" | "isAncestor" | "containingBranches" | "countBehind" | "creationReflog" | "tipAt";
export interface GitFault { method: GitMethod | "*"; kind: GitFaultKind; }

export const GIT_METHODS: GitMethod[] = ["lsRemoteHeads", "fetch", "isAncestor", "containingBranches", "countBehind", "creationReflog", "tipAt"];

export class GitFaultInjector {
  private pending: GitFault | null = null;
  arm(method: GitMethod | "*", kind: GitFaultKind): void { this.pending = { method, kind }; }
  clear(): void { this.pending = null; }
  get isArmed(): boolean { return this.pending !== null; }
  get pendingFault(): GitFault | null { return this.pending === null ? null : { ...this.pending }; }
  consume(method: string): PortError | null {
    if (this.pending === null) return null;
    if (this.pending.method !== "*" && this.pending.method !== method) return null;
    const fault = this.pending;
    this.pending = null;
    if (fault.kind === "timeout") return new PortError("timeout", "git " + method + " timeout (seeded fault, virtual clock)");
    return new PortError("failed", "git " + method + " failed (seeded fault)");
  }
}
