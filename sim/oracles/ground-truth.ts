import type { BranchState } from "../../modules/branches/index.ts";
import type { Oracle, Violation } from "./oracle.ts";
import type { SimWorld } from "../world/world.ts";

interface Expected {
  base: string | null;
  status: string;
  behindBy: number | null;
  headOid: string;
  baseOid: string | null;
}

type OwnResult = { kind: "base"; base: string } | { kind: "needs_base" } | { kind: "ambiguous"; reason: string };

function descendantsOf(branch: string, bases: Readonly<Record<string, string>>): Set<string> {
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

function ownResolve(world: SimWorld, branch: string, heads: ReadonlyMap<string, string>): OwnResult {
  const remote = world.remote;
  const prTargets = [
    ...new Set(
      world.forge
        .observedPullRequests()
        .filter((p) => p.head === branch && !p.crossRepository)
        .map((p) => p.base),
    ),
  ].filter((t) => t !== branch && heads.has(t));
  if (prTargets.length > 1) return { kind: "ambiguous", reason: "multiple_prs" };
  const pr = prTargets[0] ?? null;
  const explicitRaw = world.config.repo.bases[branch];
  const explicit = explicitRaw !== undefined && explicitRaw !== branch && heads.has(explicitRaw) ? explicitRaw : null;
  if (explicit !== null && pr !== null && explicit !== pr) return { kind: "ambiguous", reason: "explicit_pr_mismatch" };
  if (explicit !== null) return { kind: "base", base: explicit };
  if (pr !== null) return { kind: "base", base: pr };
  const creation = remote.creationRecord(branch);
  if (creation === null) return { kind: "needs_base" };
  if (
    creation.createdFrom === creation.oid ||
    (/^[0-9a-f]{7,40}$/i.test(creation.createdFrom) &&
      creation.oid.toLowerCase().startsWith(creation.createdFrom.toLowerCase()))
  ) {
    const candidates = [...heads.keys()]
      .filter((c) => c !== branch)
      .sort()
      .slice(0, 200);
    const matches = candidates.filter((c) => remote.tipAtBranch(c, creation.unixSeconds) === creation.oid);
    if (matches.length !== 1) return { kind: "needs_base" };
    const only = matches[0];
    if (only === undefined) return { kind: "needs_base" };
    const target = heads.get(only);
    if (target === undefined || !remote.isAncestorOid(creation.oid, target)) return { kind: "needs_base" };
    return { kind: "base", base: only };
  }
  let name = creation.createdFrom;
  if (name.startsWith("refs/heads/")) name = name.slice("refs/heads/".length);
  if (name === branch || !heads.has(name)) return { kind: "needs_base" };
  const target = heads.get(name);
  if (target === undefined || !remote.isAncestorOid(creation.oid, target)) return { kind: "needs_base" };
  return { kind: "base", base: name };
}

function ownMarkCycles(results: Map<string, OwnResult>): Map<string, OwnResult> {
  const edges = new Map<string, string>();
  for (const [branch, r] of results) if (r.kind === "base") edges.set(branch, r.base);
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
      index.set(current, path.length);
      path.push(current);
      current = edges.get(current);
    }
  }
  const out = new Map<string, OwnResult>();
  for (const [branch, r] of results) out.set(branch, onCycle.has(branch) ? { kind: "ambiguous", reason: "cycle" } : r);
  return out;
}

function expectedStates(world: SimWorld): Map<string, Expected> {
  const remote = world.remote;
  const heads = remote.observedHeads.size > 0 ? remote.observedHeads : remote.branches;
  const isAnc = (a: string, b: string): boolean => {
    if (a === b) return true;
    const ha = heads.get(a);
    const hb = heads.get(b);
    if (ha !== undefined && ha === hb) return true;
    if (ha === undefined || hb === undefined) return false;
    return remote.isAncestorOid(ha, hb);
  };
  const resolved = new Map<string, OwnResult>();
  for (const branch of [...heads.keys()].sort()) {
    if (remote.defaultBranch !== null && branch === remote.defaultBranch) continue;
    resolved.set(branch, ownResolve(world, branch, heads));
  }
  const marked = ownMarkCycles(resolved);
  const bases: Record<string, string> = {};
  for (const [branch, r] of marked) if (r.kind === "base") bases[branch] = r.base;
  const expected = new Map<string, Expected>();
  for (const branch of [...heads.keys()].sort()) {
    if (remote.defaultBranch !== null && branch === remote.defaultBranch) continue;
    const branchHead = heads.get(branch);
    if (branchHead === undefined) continue;
    const result = marked.get(branch);
    if (result === undefined) continue;
    if (result.kind === "base") {
      const baseHead = heads.get(result.base);
      if (baseHead !== undefined && isAnc(branch, result.base)) continue;
    }
    const descendants = descendantsOf(branch, bases);
    let mergedElsewhere = false;
    for (const other of heads.keys()) {
      if (other === branch || descendants.has(other)) continue;
      if (isAnc(branch, other)) {
        mergedElsewhere = true;
        break;
      }
    }
    if (mergedElsewhere) continue;
    if (result.kind !== "base") {
      expected.set(branch, { base: null, status: result.kind, behindBy: null, headOid: branchHead, baseOid: null });
      continue;
    }
    const baseHead = heads.get(result.base);
    if (baseHead === undefined) continue;
    const behindBy = remote.countBehindOids(branchHead, baseHead);
    expected.set(branch, {
      base: result.base,
      status: behindBy > 0 ? "behind" : "up_to_date",
      behindBy,
      headOid: branchHead,
      baseOid: baseHead,
    });
  }
  return expected;
}

export const groundTruth: Oracle = {
  id: "ground-truth",
  kind: "safety",
  check(world: SimWorld): Violation[] {
    const violations: Violation[] = [];
    const expected = expectedStates(world);
    const actual = new Map<string, BranchState>();
    for (const state of world.store.listBranchStates())
      if (state.repo === world.repoName) actual.set(state.branch, state);
    for (const [branch, want] of expected) {
      const got = actual.get(branch);
      if (got === undefined) {
        violations.push({
          oracle: "ground-truth",
          kind: "safety",
          detail:
            "missing branch_state for " +
            branch +
            " expected base=" +
            want.base +
            " status=" +
            want.status +
            " behindBy=" +
            want.behindBy,
        });
        continue;
      }
      if (
        got.base !== want.base ||
        got.status !== want.status ||
        got.behindBy !== want.behindBy ||
        got.headOid !== want.headOid ||
        got.baseOid !== want.baseOid
      ) {
        violations.push({
          oracle: "ground-truth",
          kind: "safety",
          detail:
            branch +
            " expected {base:" +
            want.base +
            ",status:" +
            want.status +
            ",behindBy:" +
            want.behindBy +
            ",headOid:" +
            want.headOid +
            ",baseOid:" +
            want.baseOid +
            "} got {base:" +
            String(got.base) +
            ",status:" +
            got.status +
            ",behindBy:" +
            String(got.behindBy) +
            ",headOid:" +
            got.headOid +
            ",baseOid:" +
            String(got.baseOid) +
            "}",
        });
      }
    }
    for (const branch of actual.keys()) {
      if (!expected.has(branch))
        violations.push({ oracle: "ground-truth", kind: "safety", detail: "extra branch_state for " + branch });
    }
    return violations;
  },
};
