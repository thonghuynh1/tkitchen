---
repo: F:/MyWork/tkitchen
status: closed
type: AFK
covers: [RB-001 (git faults), RB-002 (force-push repeats), RB-004, DEC-008 (timeouts, incomplete rule), DEC-012 (git faults, progress oracle)]
---

## Parent

`.scratch/tkitchen-v1/PRD.md`

## What to build

The Round stays correct under every git fault and awkward history: git timeouts, a fetch that fails after `ls-remote` saw a change, force-pushes back and forth (a repeated head whose Trigger is a duplicate), deleted branches, and a progress oracle proving notices converge once the world is quiet.

## Implementation map

**Consumes**: issue 05's Round (git + forge, incomplete rule for forge failures), issue 03's world, runner and oracles, issue 04's reflog model.

**Real adapter** (`src/infrastructure/git/`): every spawn has a 20 s timeout (named constant `GIT_TIMEOUT_MS = 20_000`; magic numbers are linted) that kills the process and raises `PortError("timeout")`; non-zero exit raises `PortError("failed")`. Spawn env `GIT_TERMINAL_PROMPT=0`.

**Round** (`src/application/round.ts`): any `PortError` from **any** port (git or forge) at **any** step → incomplete Round (no Trigger, Disposition, `branch_state` or `repo_heads` change; `round_status.last_error` set). Branch deleted on the remote → its `branch_state` row is deleted in the next complete Round (closes its notice).

**Force-push repeat** (DEC-004/DEC-005): C goes X→Y→X→Y. The second move to Y has the same Trigger id as the first (`hash(repo, C, Y)`), so `INSERT OR IGNORE` drops it and no new Disposition is written; `branch_state` must still be correct because staleness is recomputed from current heads, not from Triggers.

**Sim** (`tests/sim/faults/`): seeded faults on `SimRemote`: `timeout` on any method, `fetch fails after ls-remote changed`, `force-push <branch> to an older commit`, `delete <branch>`. Oracles (`tests/sim/oracles/`):
- `incomplete-changes-nothing` (from issue 05) now also covers git faults.
- `progress`: after the last actor step, run Rounds with no faults until one completes; `branch_state` must then equal ground truth (one complete Round suffices).
- Pinned scenarios `tests/sim/scenarios/`: `force-push-repeat.sim.ts` and `fetch-fails-after-ls-remote.sim.ts` with fixed seeds.

**Mechanics left to the implementer**: fault weights, how the fake times out (virtual clock).

## Acceptance criteria

- [x] Git timeout makes the Round incomplete
  - Run: `npm test -- tests/infrastructure/git-timeout.test.ts`
  - Test: the real git runner with `GIT_TIMEOUT_MS` overridden to 200 via the runner's options, running a git hook or a `GIT_SSH_COMMAND`/`ext::` remote that sleeps; then a CLI `round` on a temp repo whose origin URL points at that slow transport.
  - Expected: `PortError` kind `timeout` within 1 s; `round` exits 1; store row contents unchanged; `round_status.last_error` mentions `timeout`.
  - Fails when: the process is not killed or the Round writes partially.
- [x] Fetch failure after a changed ls-remote changes nothing
  - Run: `npm run test:sim -- tests/sim/scenarios/fetch-fails-after-ls-remote.sim.ts`
  - Expected: after the failing Round, `repo_heads` still holds the old heads; the next Round records the move and marks children behind.
  - Fails when: `repo_heads` is advanced before the write transaction.
- [x] Force-push repeat keeps state correct
  - Run: `npm run test:sim -- tests/sim/scenarios/force-push-repeat.sim.ts`
  - Expected: C X→Y→X→Y with Rounds between each: `event` has 3 rows (Y, X, then the second Y deduped), and after the last Round `branch_state` for C's children equals ground truth (behind Y).
  - Fails when: notices are derived from the latest Disposition instead of current heads.
- [x] Deleted branch closes its notice
  - Run: `npm run test:sim`
  - Expected: `ground-truth` 0 violations with `delete` actions enabled (a deleted child has no `branch_state` row after the next complete Round).
  - Fails when: rows for deleted branches linger.
- [x] Progress: quiet world converges
  - Run: `npm run test:sim`
  - Expected: `progress` 0 violations across the batch.
  - Fails when: a Round that completes leaves state behind ground truth.
- [x] No transaction across port calls, with faults
  - Run: `npm run test:sim`
  - Expected: `no-tx-across-port` 0 violations with faults enabled.
  - Fails when: an error path opens a transaction early.

## Comments

Implemented by eng-06 (2026-11-24). Real git adapter exports `GIT_TIMEOUT_MS = 20_000` with a `createGitRunner({ timeoutMs })` / `GitRepoImpl` options override; timeout kills the spawn and raises `PortError("timeout")`, and the CLI accepts `TKITCHEN_GIT_TIMEOUT_MS`. Sim gained seeded git faults (`tests/sim/faults/`) on any SimRemote method, a force-push-to-older actor action, a `progress` oracle checked after fault-free quiet Rounds, and pinned scenarios `force-push-repeat.sim.ts` / `fetch-fails-after-ls-remote.sim.ts` (fixed seeds 6101-6104). One reading note: with the DEC-005 id the X->Y->X->Y sequence stores 2 unique events (Y, X) with the second Y deduped, not 3 rows; state correctness is asserted from current heads. Evidence: `.verification-evidence/eng-06-report.md`. Full gate observed: `npm run verify` exit 0 (lint, typecheck, structure, 77/77 tests, sim 15/15 with 200 seeds and 0 violations). Independent review by qa-06 is still required.

## Independent QA (qa-06)

verdict: fail
commit:629d729039af0bb81e371a95377a8fc123a0be2a

Fresh `npm run verify` passed (77 unit/integration tests, 15 simulation tests, 200 seeds, zero violations). However, a saved independent probe reproduced a P1 fault-handling defect at `src/infrastructure/git/git-repo.ts:87,109`: fatal non-zero reflog exits (128) return `null` instead of `PortError("failed")`. Delegating Round's reflog read to this production adapter caused a successful Round to advance stored heads and replace a known Base with `needs_base`, with no `last_error`. Operational read failure must be distinguished from legitimately absent evidence and leave the Round incomplete. Source was not edited. Evidence and rerunnable probe: `F:/MyWork/tkitchen/.verification-evidence/qa-06/report.md` and `probe.mts` in that directory. Implementation repair and re-review remain required.

The force-push event-count wording is inconsistent: DEC-005 yields two unique rows for X->Y->X->Y, not three; this is not the failure reason.

Repair round 1 (eng-06, 2026-11-24): fixed qa-06 P1 — `creationReflog`/`tipAt` in `src/infrastructure/git/git-repo.ts` now classify non-zero reflog exits: legitimately absent reflog stderr (verified against real git: `unknown revision or path not in the working tree`, `ambiguous argument`, `no reflog for`, `does not exist`) still returns `null`, any other failure raises `PortError("failed")` so the Round is incomplete with `last_error` set. Regression coverage: `tests/infrastructure/git-reflog-failure.test.ts` and `tests/sim/scenarios/reflog-failure.sim.ts`; the saved QA probe now raises the PortError instead of reproducing the defect. Full gate: `npm run verify` exit 0 (80/80 tests, sim 17/17, 200 seeds 0 violations). Evidence: `.verification-evidence/eng-06-repair-report.md`. Ready for qa-06 re-review.

## Independent re-review (qa-06)

verdict: pass
commit:c5aef267138d21dc1184786b3366e4c1ec5fcdc2

The prior P1 is closed at this commit. Fresh `npm run verify` passed lint, typecheck, structure, 80 unit/integration tests and 17 simulation tests, including the 200-seed sweep with zero violations. An independent saved probe checked 10 fatal-error classifications across both reflog methods, preserved absent-evidence behavior, and confirmed that each failing Round leaves all four stored-data groups and lastCompleteAt unchanged while recording lastError; removing the fault converges on the next Round and clears the error. Evidence: `F:/MyWork/tkitchen/.verification-evidence/qa-06-rereview/report.md`, with `probe.mts`, `probe-result.json`, and `verification.log` alongside it. No source edits or merges were made. This pass supersedes the earlier fail only for the reviewed commit; the event-count documentation note remains as previously recorded.

## Blocked by

- Local: `05-github-pr-targets-via-gh.md` — provides the Round with forge evidence and the `incomplete-changes-nothing` oracle this issue extends to git faults. Proof: the sweep above runs that oracle over git faults.
