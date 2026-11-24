---
repo: F:/MyWork/tkitchen
status: closed
type: AFK
covers: [US-003 (reflog rungs, needs_base, ambiguous, hint), DEC-006 (domain resolveBase, reflog rungs, cycles), DEC-009 (needs_base hint, --history)]
---

## Parent

`.scratch/tkitchen-v1/PRD.md`

## What to build

Bases found without config: a pure `resolveBase(evidence)` in the domain with the full rung order, git evidence readers for the creation reflog and branch tips at a time, and `tkitchen notices` showing `needs_base` (with a config hint) and `ambiguous` branches. Plus `tkitchen notices --history`. The PR rung's **slot** exists here (evidence field `prTargets`, always empty until issue 05).

## Implementation map

**Rung order (DEC-006)**, ported from `F:/MyWork/pi-selftools/saved-tools/github_publish_pbi_prs.ts` lines ~392-434 (GROUND-001; it is a saved-tool body bound to one org and PBI ids, so port the logic, do not import it):
1. **explicit**: `config.bases[branch]`, valid when that base is a pushed head.
2. **pr**: the base of the single open PR whose head is the branch (`prTargets`, filled in issue 05). Explicit and PR both present and different → `ambiguous` (pi-selftools: `if (spec.base && pr && spec.base!==pr.base.ref) stop('base_mismatch')`). Two or more open PRs from the same head with different bases → `ambiguous`.
3. **reflog**: the branch's local reflog (`git reflog show --format=%H%x09%gs refs/heads/<branch>`) has exactly one entry `branch: Created from <name>` and it is the oldest entry; `<name>` (strip `refs/heads/`, `origin/`, `refs/remotes/origin/`) is a pushed head other than the branch, and the creation commit is an ancestor of that head (`merge-base --is-ancestor`).
4. **reflog-tip**: the creation entry names a commit (`Created from <7-40 hex>` matching the entry's oid); take the creation time from `git reflog show --date=unix --format=%H%x09%gd refs/heads/<branch>` (last line); a candidate (pushed head other than the branch, at most 200 candidates) matches when its `refs/remotes/<remote>/<c>` or `refs/heads/<c>` reflog tip at that time equals the creation commit; exactly one match, ancestry-verified → base. Zero or several → no answer from this rung.
5. otherwise **needs_base**. Never merge-base.
- After resolving all branches, a cycle in the base graph → every branch on it `ambiguous` (herdr `mergeChain` stops on cycles: `F:/MyWork/my-pi/herdr-app/mods/github-prs/merge.js`, GROUND-003).
- Reflog rungs only know branches created on this machine; other authors' branches rely on the PR rung (issue 05).

**Domain** `src/domain/base/`:
```ts
type BaseEvidence = {
  branch: string;
  explicit: string | null;
  prTargets: readonly string[];
  creation: { kind: "named"; name: string; startIsAncestor: boolean }
          | { kind: "commit"; matches: readonly string[]; startIsAncestorOfMatch: boolean }
          | null;
  pushed: ReadonlySet<string>;
};
type BaseResult =
  | { kind: "base"; base: string; evidence: "explicit" | "pr" | "reflog" | "reflog-tip" }
  | { kind: "needs_base" }
  | { kind: "ambiguous"; reason: "explicit_pr_mismatch" | "multiple_prs" | "cycle" };
export function resolveBase(e: BaseEvidence): BaseResult;
export function markCycles(results: Map<string, BaseResult>): Map<string, BaseResult>;
```

**Ports** (`src/application/ports.ts`, extend `GitRepo` from issue 01):
```ts
creationReflog(branch: string): Promise<{ oid: string; createdFrom: string; unixSeconds: number } | null>;
tipAt(ref: string, unixSeconds: number): Promise<string | null>;
```
Real adapter in `src/infrastructure/git/` (commands: `reflog show`, `merge-base --is-ancestor`; RB-007). `SimRemote` (issue 03) gains a per-machine reflog model (creation entries written when a sim developer creates a branch "on this machine"; branches created by "other machines" have none), and the contract suite (`tests/contract/git-repo.contract.ts`) gains cases for both methods.

**Round** (`src/application/round.ts`): gather `BaseEvidence` per watched branch, call `resolveBase` + `markCycles`; `needs_base` and `ambiguous` branches get a `branch_state` row with that `status`, `base NULL`, `behind_by NULL`; they are never children in the tree.

**Notices** (`src/application/notices.ts`): human output for `needs_base` prints `add "bases": { "<branch>": "<base>" } to <config path>`; `ambiguous` prints its reason. `--history`: every Trigger (newest first) with its Dispositions (`thread`, `outcome`, `meta.behindBy`); `--json --history` prints `{ history: [{ event, dispositions }] }`.

**Sim**: the ground-truth oracle (issue 03) computes expected bases with its own implementation of the same rung order from the sim's reflog model; developer actors now create branches with and without config overrides.

**Mechanics left to the implementer**: parsing helpers, candidate iteration order (sorted, as in pi-selftools).

## Acceptance criteria

- [x] Each rung, from hand-built evidence
  - Run: `npm test -- tests/domain/base.test.ts`
  - Expected: explicit only → `{base, evidence:"explicit"}`; PR only → `"pr"`; named creation with ancestry → `"reflog"`; named creation without ancestry → `needs_base`; commit creation with one ancestry-verified match → `"reflog-tip"`; two matches → `needs_base`; nothing → `needs_base`.
  - Fails when: the order changes or merge-base is used.
- [x] Ambiguity outcomes
  - Run: `npm test -- tests/domain/base.test.ts`
  - Expected: explicit `C` + PR target `D` → `ambiguous/explicit_pr_mismatch`; two PR targets → `ambiguous/multiple_prs`; `markCycles` on X→Y, Y→X → both `ambiguous/cycle`, others unchanged.
  - Fails when: an ambiguous case silently picks one.
- [x] Real reflog evidence end to end
  - Run: `npm test -- tests/cli/reflog-base.test.ts`
  - Test: temp bare origin + clone; `git switch -c B origin/C` (named creation) and `git branch E <oid-of-C-tip>` (commit creation), both pushed, **no config bases**; `TKITCHEN_HOME` is a temp dir.
  - Expected: after `round`, push to C, `round`: `notices --json` lists B and E `behind` C with `evidence` `"reflog"` and `"reflog-tip"`.
  - Fails when: the reflog readers parse the wrong entry or skip ancestry.
- [x] needs_base with hint
  - Run: `npm test -- tests/cli/reflog-base.test.ts` → `branch pushed from another clone is needs_base`
  - Expected: a branch created in a second clone (no local reflog in the round's clone) and not in config → `notices` line contains `needs_base` and `add "bases": { "G": "<base>" } to <temp>/config.json`.
  - Fails when: a guessed base is shown.
- [x] --history
  - Run: `npm test -- tests/cli/reflog-base.test.ts` → `history lists triggers with dispositions`
  - Expected: `notices --json --history` → one entry whose `dispositions` threads are `git:x:B` and `git:x:E`.
  - Fails when: history reads `branch_state`.
- [x] Contract suite covers the new readers
  - Run: `npm test -- tests/contract/git-repo.test.ts`
  - Expected: `creationReflog` (named, commit, none) and `tipAt` (before creation, after creation) pass for both `SimRemote` and real git.
  - Fails when: the double and real git disagree.
- [x] Sweep with reflog bases
  - Run: `npm run test:sim`
  - Expected: exit 0 with branches created both with and without overrides; ground-truth 0 violations.
  - Fails when: the round's bases differ from the oracle's.

## Blocked by

- Local: `03-dst-harness-and-ground-truth-oracle.md` — provides `SimRemote`, the ground-truth oracle and the contract suite this issue extends. Proof: `npm run test:sim` and `tests/contract/git-repo.test.ts` above run the extended doubles.
- (Transitively `01-walking-skeleton-round-and-notices.md`: `round.ts`, `notices.ts`, the `GitRepo` port.)

## Comments

Implemented by eng-04 (2026-11-23). Pure `resolveBase`/`markCycles` in `src/domain/base/base.ts`; `creationReflog`/`tipAt` added to the `GitRepo` port, real git adapter, and the `SimRemote` reflog model (snapshotted at `lsRemoteHeads`); the Round resolves bases before building the watched tree; `notices` prints the `needs_base` config hint and `ambiguous` reasons, and `notices --history` (human and `--json`) lists Triggers with their Dispositions. Evidence: `.verification-evidence/eng-04-report.md`.


QA qa-04 (2026-11-23): verdict: fail. Existing suite 63/63 and sim suite 10/10 pass, but a real-git CLI counterexample shows `normalizeCreatedName` strips arbitrary `refs/remotes/<remote>/` prefixes. A branch created from `refs/remotes/foreign/C` is incorrectly assigned base `origin/C` when they share ancestry; it must remain `needs_base` rather than guess. Configured-origin positive control passes. Evidence and rerunnable probe: `F:/MyWork/tkitchen/.verification-evidence/qa-04-report.md` and `qa-04-foreign-remote.test.mjs`. Reviewed HEAD is `8308f71146fba6d5dc532e1c309e1c4bd632e432`; implementation is currently untracked working-tree content, not committed at HEAD. Source files were not changed.

Repair round 1 (eng-04): fixed QA04-1. `normalizeCreatedName` in `src/application/round.ts` now strips a `refs/remotes/<segment>/` prefix only for the configured remote or the `origin` alias; a creation entry naming `refs/remotes/foreign/C` therefore yields `needs_base`, never the same-named `origin/C`. Regression test added in `tests/cli/reflog-base.test.ts`. QA probe passes 2/2; full gate 64/64 plus sim 200 seeds clean. Evidence: `.verification-evidence/eng-04-repair-report.md`.


QA qa-04 re-review (2026-11-23): verdict: pass for the supplied working-tree repair. QA04-1 resolved: unchanged independent CLI probe passes 2/2; foreign remote yields `needs_base` with null base/behindBy while origin positive control still resolves C. Fresh full suite 64/64, sim suite 10/10, lint/typecheck/structure all pass. Evidence: `F:/MyWork/tkitchen/.verification-evidence/qa-04-rereview-report.md`. Pinned HEAD remains `8308f71146fba6d5dc532e1c309e1c4bd632e432`; implementation remains untracked, so this is not a claim that HEAD contains the repair. No source edits or merges by QA.
