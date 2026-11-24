---
repo: F:/MyWork/tkitchen
status: closed
type: AFK
covers: [US-003 (other authors via PRs), DEC-007, DEC-006 (pr rung), DEC-008 (PR list every Round), RB-001 (gh failure), RB-006]
---

## Parent

`.scratch/tkitchen-v1/PRD.md`

## What to build

Other authors' branches get their base from open GitHub PRs. A `Forge` port, a `GitHubForge` adapter calling `gh`, a `SimForge` double with a shared contract suite, the PR list read **every Round**, and a `gh` failure making the Round incomplete (nothing written, retried next Round).

## Implementation map

**Port** (`src/application/ports.ts`):
```ts
export type PullRequest = { number: number; head: string; base: string; url: string; author: string; crossRepository: boolean };
export interface Forge { listOpenPullRequests(repo: RepoConfig): Promise<PullRequest[]> }
```
**Adapter** `src/infrastructure/github/github-forge.ts`: in `repo.path`, run `gh pr list --state open --json number,headRefName,baseRefName,url,author,isCrossRepository --limit 200` with env `GH_PROMPT_DISABLED=1`, 20 s timeout. Non-zero exit, timeout, or JSON that does not match the shape → `PortError("failed" | "timeout")`. Map `headRefName→head`, `baseRefName→base`, `author.login→author`, `isCrossRepository→crossRepository`. Precedent for `gh` as the GitHub client: `F:/MyWork/my-pi/herdr-app/mods/github-prs/merge.js` → `mergeChain` (uses `gh api …/pulls?state=open`; GROUND-003). Repos whose config `forge` is not `"github"` are rejected by config validation (only GitHub in v1, user decision K11).

**Round changes** (`src/application/round.ts`):
- Call `Forge.listOpenPullRequests` **every Round**, after `lsRemoteHeads`, before deciding whether to fetch (RB-006).
- Ignore PRs with `crossRepository: true`. For each watched branch, `prTargets` = bases of open PRs whose `head` is that branch and whose `base` is a pushed head; feed into `BaseEvidence.prTargets` (issue 04's `resolveBase` already handles `pr`, `explicit_pr_mismatch`, `multiple_prs`).
- A changed PR target or a config edit with no push must update the tree and `branch_state` in that Round (staleness rule from issue 01: recompute when the child's resolved base changed).
- Any `PortError` from the forge → the Round is **incomplete**: no Trigger, no Disposition, `branch_state` and `repo_heads` unchanged; `round_status.last_error` set to the message; `round` exits 1 (RB-001).

**Composition**: `src/cli/tkitchen.ts` wires `GitHubForge`; the sim wires `SimForge`.

**Sim** (`tests/sim/doubles/sim-forge.ts`): `SimForge` with actor actions `open PR <head>→<base>`, `retarget PR`, `close PR`, `open second PR from same head`, `open fork PR`; fault `forge fails for this call` (seeded). Branches created "on another machine" (no reflog) get their base only through a PR. Ground-truth oracle includes PR evidence. New oracle `incomplete-changes-nothing`: after an incomplete Round, `event`, `disposition`, `branch_state`, `repo_heads` are byte-identical to before.

**Contract suite** `tests/contract/forge.contract.ts` + `forge.test.ts`: the same cases against `SimForge` and against `GitHubForge` with a fake `gh` executable on `PATH` (a node script in `tests/fixtures/fake-gh/` that prints a recorded JSON fixture or exits 1 when `FAKE_GH_FAIL=1`). Cases: two PRs mapped correctly; fork PR flagged; failure → `PortError`.

**Mechanics left to the implementer**: fake `gh` implementation details, JSON validation helper.

## Acceptance criteria

- [x] Teammate's branch gets its base from a PR
  - Run: `npm test -- tests/cli/pr-base.test.ts`
  - Test: temp origin + clone; feature-2 pushed from a second clone (no local reflog, no config base); fake `gh` on `PATH` returns an open PR `feature-2 → feature-1`.
  - Expected: after baseline `round`, push to feature-1, `round` → `notices --json` lists feature-2 `behind` feature-1 with `evidence: "pr"`.
  - Fails when: the PR list is not read or not mapped into evidence.
- [x] Retarget without a push updates the tree (RB-006)
  - Run: same file → `retarget is seen without a push`
  - Expected: fake `gh` changes feature-2's base to `main` between two `round` calls with no git push; second `round` → feature-2's `branch_state.base = "main"`.
  - Fails when: the forge is only called when heads change.
- [x] gh failure makes the Round incomplete (RB-001)
  - Run: same file → `gh failure changes nothing`
  - Expected: with `FAKE_GH_FAIL=1` and a pushed change to feature-1, `round` exits 1; `event`, `disposition`, `branch_state`, `repo_heads` row contents identical to before; `round_status.last_error` non-null; the next `round` without the failure records the move.
  - Fails when: the Round falls back to reflog-only and advances `repo_heads`.
- [x] Fork PRs ignored; mismatch and duplicate PRs are ambiguous
  - Run: same file → `fork and ambiguous prs`
  - Expected: a fork PR adds no base; config base `C` plus a PR to `D` → `ambiguous` (`explicit_pr_mismatch`); two PRs from one head → `ambiguous` (`multiple_prs`).
  - Fails when: either case picks a base.
- [x] SimForge matches GitHubForge
  - Run: `npm test -- tests/contract/forge.test.ts`
  - Expected: every case passes for both.
  - Fails when: the adapter mis-maps a field.
- [x] Sweep with PRs and forge faults
  - Run: `npm run test:sim`
  - Expected: exit 0; `ground-truth` and `incomplete-changes-nothing` 0 violations.
  - Fails when: any seed's Round writes after a forge fault.
- [x] Harness proof: advancing heads on a forge failure is caught
  - Run: `npm run test:sim -- tests/sim/round.sim.ts` → `mutant: advance heads on forge failure is caught`
  - Expected: a round variant that writes `repo_heads` despite a forge failure fails with a printed `seed=`.
  - Fails when: the oracle does not compare `repo_heads`.

## Blocked by

- Local: `04-automatic-base-from-reflog-and-needs-base.md` — provides `resolveBase` with the `prTargets` evidence slot and `ambiguous` outcomes, which this issue fills. Proof: the `evidence: "pr"` criterion above passes only if the round feeds `prTargets` into that function.

## Comments

Implemented by eng-05 (2026-11-23), following poteto-mode (feature playbook). `Forge` port and `PullRequest` type in `src/application/ports.ts`; `GitHubForge` adapter in `src/infrastructure/github/github-forge.ts` calling `gh pr list` with boundary-only JSON validation; the Round reads open PRs every Round after `lsRemoteHeads` and before fetch, groups non-fork PR bases by head into `BaseEvidence.prTargets`, and a forge `PortError` makes the Round incomplete (nothing written, `round_status.last_error` set, exit 1). The CLI wires `GitHubForge` and config validation rejects a non-`"github"` forge. Sim gains `SimForge` with PR actions and a seeded fault, PR evidence in the ground-truth oracle, an `incomplete-changes-nothing` oracle over event/disposition/branch_state/repo_heads snapshots, and a caught `advance heads on forge failure` mutant. Contract suite runs the same cases against `SimForge` and `GitHubForge` with the fake `gh` fixture in `tests/fixtures/fake-gh/`; all CLI tests now run against that fake `gh` by default. Evidence: `.verification-evidence/eng-05-report.md`. Full gate observed: `npm run verify` exit 0 (lint, typecheck, structure, 74/74 tests, sim 11/11 with 200 seeds and 0 violations). Independent review by qa-05 completed with verdict: pass. Evidence: `F:/MyWork/tkitchen/.verification-evidence/qa-05-report.md`. QA independently ran the full verification gate, seven additional boundary tests, and a 200-seed sweep with zero violations; the head-advance mutant was caught at seed 1. Reviewed HEAD is `8308f71146fba6d5dc532e1c309e1c4bd632e432`; implementation remains uncommitted working-tree content, bound by the SHA-256 manifest in `qa-05-reviewed-manifest.json`. No source files were changed by QA.
