import type { GitRepo } from "../../../src/application/ports.ts";

export class CrashError extends Error {
  constructor(message: string) { super(message); this.name = "CrashError"; }
}

export function crashingGit(inner: GitRepo, afterCalls: number, onCrash: () => void): GitRepo {
  let calls = 0;
  const gate = (): void => {
    calls += 1;
    if (calls > afterCalls) {
      onCrash();
      throw new CrashError("simulated crash after " + afterCalls + " port calls");
    }
  };
  return {
    async lsRemoteHeads(remote: string) { gate(); return inner.lsRemoteHeads(remote); },
    async fetch(remote: string) { gate(); return inner.fetch(remote); },
    async isAncestor(ancestor: string, descendant: string) { gate(); return inner.isAncestor(ancestor, descendant); },
    async countBehind(child: string, base: string) { gate(); return inner.countBehind(child, base); },
    async creationReflog(branch: string) { gate(); return inner.creationReflog(branch); },
    async tipAt(ref: string, unixSeconds: number) { gate(); return inner.tipAt(ref, unixSeconds); },
  };
}
