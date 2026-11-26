import type { BranchState } from "../../branches/index.ts";
export interface Notice { repo: string; branch: string; base: string | null; evidence: string | null; status: string; behindBy: number | null; lastEventId: string | null; }
export function noticeFromState(s: BranchState): Notice {
  return { repo: s.repo, branch: s.branch, base: s.base, evidence: s.baseEvidence, status: s.status, behindBy: s.behindBy, lastEventId: s.lastEventId };
}
export function isOpenStatus(status: string): boolean { return status === "behind" || status === "needs_base" || status === "ambiguous"; }
