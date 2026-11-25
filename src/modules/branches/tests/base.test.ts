import { describe, it, expect } from "vitest";
import { resolveBase, markCycles } from "../index.ts";
import type { BaseEvidence, BaseResult } from "../index.ts";

function ev(partial: Partial<BaseEvidence>): BaseEvidence {
  return { branch: "B", explicit: null, prTargets: [], creation: null, pushed: new Set(["B", "C", "D", "main"]), ...partial };
}

describe("resolveBase", () => {
  it("explicit only", () => {
    expect(resolveBase(ev({ explicit: "C" }))).toEqual({ kind: "base", base: "C", evidence: "explicit" });
  });
  it("PR only", () => {
    expect(resolveBase(ev({ prTargets: ["C"] }))).toEqual({ kind: "base", base: "C", evidence: "pr" });
  });
  it("explicit and PR agreeing uses explicit", () => {
    expect(resolveBase(ev({ explicit: "C", prTargets: ["C"] }))).toEqual({ kind: "base", base: "C", evidence: "explicit" });
  });
  it("named creation with ancestry", () => {
    expect(resolveBase(ev({ creation: { kind: "named", name: "C", startIsAncestor: true } }))).toEqual({ kind: "base", base: "C", evidence: "reflog" });
  });
  it("named creation without ancestry", () => {
    expect(resolveBase(ev({ creation: { kind: "named", name: "C", startIsAncestor: false } }))).toEqual({ kind: "needs_base" });
  });
  it("named creation not pushed", () => {
    expect(resolveBase(ev({ creation: { kind: "named", name: "gone", startIsAncestor: true } }))).toEqual({ kind: "needs_base" });
  });
  it("explicit not pushed falls through to reflog", () => {
    expect(resolveBase(ev({ explicit: "gone", creation: { kind: "named", name: "C", startIsAncestor: true } }))).toEqual({ kind: "base", base: "C", evidence: "reflog" });
  });
  it("commit creation with one ancestry-verified match", () => {
    expect(resolveBase(ev({ creation: { kind: "commit", matches: ["C"], startIsAncestorOfMatch: true } }))).toEqual({ kind: "base", base: "C", evidence: "reflog-tip" });
  });
  it("commit creation with one match but no ancestry", () => {
    expect(resolveBase(ev({ creation: { kind: "commit", matches: ["C"], startIsAncestorOfMatch: false } }))).toEqual({ kind: "needs_base" });
  });
  it("commit creation with two matches", () => {
    expect(resolveBase(ev({ creation: { kind: "commit", matches: ["C", "D"], startIsAncestorOfMatch: true } }))).toEqual({ kind: "needs_base" });
  });
  it("nothing", () => {
    expect(resolveBase(ev({}))).toEqual({ kind: "needs_base" });
  });
  it("explicit C plus PR target D is ambiguous", () => {
    expect(resolveBase(ev({ explicit: "C", prTargets: ["D"] }))).toEqual({ kind: "ambiguous", reason: "explicit_pr_mismatch" });
  });
  it("two PR targets is ambiguous", () => {
    expect(resolveBase(ev({ prTargets: ["C", "D"] }))).toEqual({ kind: "ambiguous", reason: "multiple_prs" });
  });
  it("duplicate PR targets with same base are one", () => {
    expect(resolveBase(ev({ prTargets: ["C", "C"] }))).toEqual({ kind: "base", base: "C", evidence: "pr" });
  });
});

describe("markCycles", () => {
  it("marks X to Y and Y to X as cycle, others unchanged", () => {
    const input = new Map<string, BaseResult>([
      ["X", { kind: "base", base: "Y", evidence: "explicit" }],
      ["Y", { kind: "base", base: "X", evidence: "explicit" }],
      ["Z", { kind: "base", base: "X", evidence: "explicit" }],
      ["W", { kind: "needs_base" }],
    ]);
    const out = markCycles(input);
    expect(out.get("X")).toEqual({ kind: "ambiguous", reason: "cycle" });
    expect(out.get("Y")).toEqual({ kind: "ambiguous", reason: "cycle" });
    expect(out.get("Z")).toEqual({ kind: "base", base: "X", evidence: "explicit" });
    expect(out.get("W")).toEqual({ kind: "needs_base" });
  });
  it("marks a self loop as cycle", () => {
    const out = markCycles(new Map<string, BaseResult>([["X", { kind: "base", base: "X", evidence: "explicit" }]]));
    expect(out.get("X")).toEqual({ kind: "ambiguous", reason: "cycle" });
  });
});
