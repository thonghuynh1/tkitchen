export interface GitRepo {
  lsRemoteHeads(remote: string): Promise<{ heads: Map<string, string>; defaultBranch: string | null }>;
  fetch(remote: string): Promise<void>;
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;
  containingBranches(remote: string, branch: string): Promise<string[]>;
  countBehind(child: string, base: string): Promise<number>;
  creationReflog(branch: string): Promise<{ oid: string; createdFrom: string; unixSeconds: number } | null>;
  tipAt(ref: string, unixSeconds: number): Promise<string | null>;
}
