export type BaseEvidence = {
  branch: string;
  explicit: string | null;
  prTargets: readonly string[];
  creation: { kind: "named"; name: string; startIsAncestor: boolean }
          | { kind: "commit"; matches: readonly string[]; startIsAncestorOfMatch: boolean }
          | null;
  pushed: ReadonlySet<string>;
};
export type BaseResult =
  | { kind: "base"; base: string; evidence: "explicit" | "pr" | "reflog" | "reflog-tip" }
  | { kind: "needs_base" }
  | { kind: "ambiguous"; reason: "explicit_pr_mismatch" | "multiple_prs" | "cycle" };

function isPushedHead(e: BaseEvidence, name: string | null): name is string {
  return name !== null && name !== e.branch && e.pushed.has(name);
}

export function resolveBase(e: BaseEvidence): BaseResult {
  const prTargets = [...new Set(e.prTargets)].filter((t) => isPushedHead(e, t));
  if (prTargets.length > 1) return { kind: "ambiguous", reason: "multiple_prs" };
  const pr = prTargets[0] ?? null;
  const explicit = isPushedHead(e, e.explicit) ? e.explicit : null;
  if (explicit !== null && pr !== null && explicit !== pr) return { kind: "ambiguous", reason: "explicit_pr_mismatch" };
  if (explicit !== null) return { kind: "base", base: explicit, evidence: "explicit" };
  if (pr !== null) return { kind: "base", base: pr, evidence: "pr" };
  if (e.creation?.kind === "named") {
    if (isPushedHead(e, e.creation.name) && e.creation.startIsAncestor) {
      return { kind: "base", base: e.creation.name, evidence: "reflog" };
    }
    return { kind: "needs_base" };
  }
  if (e.creation?.kind === "commit") {
    const matches = [...new Set(e.creation.matches)].filter((m) => isPushedHead(e, m));
    if (matches.length === 1 && e.creation.startIsAncestorOfMatch) {
      const base = matches[0];
      if (base !== undefined) return { kind: "base", base, evidence: "reflog-tip" };
    }
    return { kind: "needs_base" };
  }
  return { kind: "needs_base" };
}

export function markCycles(results: Map<string, BaseResult>): Map<string, BaseResult> {
  const edges = new Map<string, string>();
  for (const [branch, result] of results) if (result.kind === "base") edges.set(branch, result.base);
  const onCycle = new Set<string>();
  for (const start of edges.keys()) {
    const path: string[] = [];
    const index = new Map<string, number>();
    let current: string | undefined = start;
    while (current !== undefined && edges.has(current)) {
      const seenAt = index.get(current);
      if (seenAt !== undefined) {
        for (let i = seenAt; i < path.length; i++) {
          const node = path[i];
          if (node !== undefined) onCycle.add(node);
        }
        break;
      }
      if (index.has(current)) break;
      index.set(current, path.length);
      path.push(current);
      current = edges.get(current);
    }
  }
  const out = new Map<string, BaseResult>();
  for (const [branch, result] of results) {
    out.set(branch, onCycle.has(branch) ? { kind: "ambiguous", reason: "cycle" } : result);
  }
  return out;
}
