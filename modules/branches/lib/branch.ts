export type BranchStatus = "up_to_date" | "behind" | "needs_base" | "ambiguous";
export interface BranchState {
  repo: string;
  branch: string;
  base: string | null;
  baseEvidence: string | null;
  headOid: string;
  baseOid: string | null;
  behindBy: number | null;
  status: BranchStatus;
  since: string;
  lastEventId: string | null;
}
export function descendantsOf(branch: string, bases: Readonly<Record<string, string>>): Set<string> {
  const out = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [child, base] of Object.entries(bases)) {
      if ((base === branch || out.has(base)) && !out.has(child) && child !== branch) {
        out.add(child);
        changed = true;
      }
    }
  }
  return out;
}
export function computeWatchedBranches(input: {
  heads: ReadonlyMap<string, string>;
  defaultBranch: string | null;
  bases: Readonly<Record<string, string>>;
  isAncestor: (ancestor: string, descendant: string) => boolean;
}): string[] {
  const watched: string[] = [];
  for (const branch of input.heads.keys()) {
    if (input.defaultBranch !== null && branch === input.defaultBranch) continue;
    const base = input.bases[branch];
    if (base !== undefined && input.heads.has(base) && input.isAncestor(branch, base)) continue;
    const descendants = descendantsOf(branch, input.bases);
    let mergedElsewhere = false;
    for (const other of input.heads.keys()) {
      if (other === branch || descendants.has(other)) continue;
      if (input.isAncestor(branch, other)) {
        mergedElsewhere = true;
        break;
      }
    }
    if (mergedElsewhere) continue;
    watched.push(branch);
  }
  return watched.sort();
}
export function statusForBehind(behindBy: number): BranchStatus {
  return behindBy > 0 ? "behind" : "up_to_date";
}
