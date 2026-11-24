---
repo: F:/MyWork/tkitchen
status: closed
type: AFK
covers: [US-004 (process side), DEC-001 (serve, lock), RB-005, DEC-012 (crash/restart faults)]
---

## Parent

`.scratch/tkitchen-v1/PRD.md`

## What to build

`tkitchen serve`: one resident process per store that runs a Round for every configured repo, one at a time, every `roundMinutes` (default 15), guarded by a single-instance lock. `tkitchen round` refuses while `serve` runs. A crash at any point leaves the store consistent, and a restart takes over a stale lock.

## Implementation map

**Consumes**: issue 01's `round.ts`, `Config`, `Scheduler`, `Clock`; issue 03's world, runner and oracles.

**Port** (`src/application/ports.ts`):
```ts
export interface Lock { acquire(): Promise<"acquired" | "held">; release(): Promise<void> }
```
**Adapter** `src/infrastructure/lock-file.ts`: `$TKITCHEN_HOME/kitchen.lock`, created with exclusive flag `wx`, content `{ pid, startedAt }`. If it exists: read the pid; if `process.kill(pid, 0)` throws `ESRCH` the pid is dead → replace the file and return `acquired`; otherwise `held`. `release` deletes the file only if it still holds our pid.

**Use case** `src/application/serve.ts`: acquire the lock (`held` → print `already running (pid <n>)`, exit 1); loop: for each repo in `Config.load()` order, run the Round (errors are recorded by the Round; the loop continues); then `Scheduler.sleep(roundMinutes * MINUTE_MS)`. SIGINT/SIGTERM → finish the current Round, release, exit 0.

**CLI**: `tkitchen serve`; `tkitchen round` also calls `Lock.acquire()` and, on `held`, prints `already running (pid <n>)` and exits 1, with no bypass flag; on `acquired` it runs and releases.

**Sim** (`tests/sim/serve.sim.ts`, `tests/sim/faults/crash.ts`): run the real `serve` use case on the virtual `Scheduler` with a sim `Lock` (models pids alive/dead). Faults: `crash` between any two port calls (abandon the in-flight Round: the uncommitted transaction is lost, nothing else), then `restart` (new pid; the old pid is dead); `second serve` attempt while one runs. Oracles: `single-writer` (never two holders), plus ground-truth, `incomplete-changes-nothing`, `progress` after restart.

**Mechanics left to the implementer**: log line format, signal handling details.

## Acceptance criteria

- [x] Second serve refuses (RB-005)
  - Run: `npm test -- tests/cli/serve-lock.test.ts`
  - Test: start `node src/cli/tkitchen.ts serve` with a temp `TKITCHEN_HOME` and a config with one temp repo; wait for `kitchen.lock`; start a second `serve`.
  - Expected: second exits 1 with `already running (pid <first pid>)`; first is still running.
  - Fails when: the lock is not exclusive.
- [x] round refuses while serve runs, no bypass
  - Run: same file → `round refuses while serve runs`
  - Expected: `tkitchen round` exits 1 with `already running`; `tkitchen round --force` is rejected as an unknown flag (exit 2).
  - Fails when: `round` writes while `serve` holds the lock.
- [x] Stale lock is taken over
  - Run: same file → `dead pid lock is taken over`
  - Expected: a `kitchen.lock` holding a pid that is not running → `serve` starts and rewrites the file with its own pid.
  - Fails when: a crash leaves the kitchen unable to start.
- [x] Loop runs every repo each interval
  - Run: `npm run test:sim -- tests/sim/serve.sim.ts` → `two intervals run every repo twice`
  - Expected: with 3 repos and 2 virtual intervals, the trace shows 6 Rounds, repos in config order, never two at once.
  - Fails when: Rounds overlap or a repo is skipped.
- [x] Crash and restart keep the store consistent
  - Run: `npm run test:sim -- tests/sim/serve.sim.ts`
  - Expected: with crash/restart faults, `single-writer`, `ground-truth`, `incomplete-changes-nothing` and `progress` 0 violations across the batch.
  - Fails when: a crash mid-Round leaves a partial write or a stuck lock.

## Blocked by

- Local: `03-dst-harness-and-ground-truth-oracle.md` — provides the virtual `Scheduler`, runner and oracles; `serve.sim.ts` composes them with the real `serve` use case. Proof: the crash/restart criterion above.
- (Transitively `01-walking-skeleton-round-and-notices.md`: `round.ts` and the CLI router.)

## Comments

Implemented by eng-07 (2026-11-24). Added the `Lock` port (`acquired | held`, plus `holderPid()` so the CLI can print the holder pid) and `FileLock` adapter at `$TKITCHEN_HOME/kitchen.lock` (exclusive `wx` create, dead-pid takeover, pid-checked release, a 1 s write-grace so a lock file read mid-creation is held rather than stolen). `serve` use case runs one Round per repo in `Config.load()` order, records PortErrors per repo and continues, sleeps `roundMinutes` on the Scheduler between cycles, and releases the lock on stop; SIGINT/SIGTERM in the CLI finish the current Round, wake the sleep, release, and exit 0. `tkitchen round` acquires the same lock with no bypass (`--force` stays an unknown flag, exit 2). Sim gained a `SimLock` double modeling live/dead pids, a `crash` fault that abandons an in-flight Round between port calls, and a `single-writer` oracle; `tests/sim/serve.sim.ts` covers two intervals over 3 repos (6 Rounds in config order), second-serve refusal, and crash/restart across 20 seeds with ground-truth, incomplete-changes-nothing, progress, and single-writer at 0 violations. Evidence: `.verification-evidence/eng-07-report.md`. Full gate observed: `npm run verify` exit 0 (lint, typecheck, structure, 89/89 tests, sim 20/20 with 200 round seeds and 0 violations). Independent review by qa-07 is recorded below.


### qa-07 independent review (2026-11-24)

verdict: fail
commit:d0d1712d38d3182be57311aed2c79b374a725100

Fresh full gate passed (89 unit/integration tests and 20 simulation tests, round seeds=200, zero reported oracle violations), but independent verification found P1 in `src/infrastructure/lock-file.ts:65-83`: two simultaneous stale-lock contenders can both read the dead pid; the delayed contender then unlinks the first contender's newly acquired live lock. A saved two-process probe reproduced both processes returning `acquired` while both remained alive and neither had released. This violates the single-writer requirement despite the existing sequential refusal and single-process takeover tests passing.

P2 coverage gap in `tests/sim/faults/crash.ts:7-23` and `tests/sim/serve.sim.ts:125-158`: crashes wrap only Git methods, with 20 seeds repeating five early call positions from an empty store. There is no injection at store/transaction boundaries or proof of abandoning partial writes while retaining existing events/dispositions. The crash/restart criterion is reopened pending that evidence. The synchronous SimLock cannot expose the real stale-lock race.

Evidence and repair requirements: `F:/MyWork/tkitchen/.verification-evidence/qa-07/report.md`. Reproduce the lock defect with `node F:/MyWork/tkitchen/.verification-evidence/qa-07/lock-race.mjs`; raw result is `lock-race-result.json` alongside it. Full gate log is `F:/MyWork/tkitchen/.verification-evidence/qa-07-verify.log`. No source files were edited. Engineering repair and independent re-review remain.

## Repair round 1 (eng-07, 2026-11-24)

Fixed qa-07 P1: `FileLock` no longer unlinks by path on a stale read. Lock content is published atomically (a completed per-pid file hard-linked into place, so the lock never exists half-written), and the whole stale-takeover sequence (re-read, unlink, publish) is serialized under an atomic `mkdir` guard with dead-owner recovery, so a contender acting on a stale read cannot delete a newly acquired live lock. `release` claims the file by rename and restores it if it is no longer ours. Regression: `tests/infrastructure/lock-file.test.ts` spawns six real contender processes against a stale lock over ten rounds and requires exactly one `acquired` with the lock file naming the winner; it produced two winners on the pre-fix code, and the saved qa-07 probe now reports `singleWriterViolation: false` with the second contender `held`.

Fixed qa-07 P2: `tests/sim/faults/crash.ts` now has a `CrashInjector` that wraps every serve port boundary (config, all Git methods, forge, store reads, `store.applyRound` as the transaction boundary, scheduler, and lock). `tests/sim/serve.sim.ts` enumerates a crash at every boundary position of a serve cycle against pre-existing committed state with a pending base move, asserting the store is either byte-identical to before or a complete ground-truth-consistent commit, then restarts and asserts one deduped event, ground-truth, progress, and single-writer at 0 violations; a dedicated case crashes at the scheduler boundary after a committed Round. Evidence: `.verification-evidence/eng-07-repair-report.md`. Full gate observed: `npm run verify` exit 0 (90/90 tests, sim 21/21, 200 round seeds 0 violations). Ready for qa-07 re-review.


### qa-07 re-review (2026-11-24)

verdict: fail
commit:a6288ec0bcae0ba2ab302ed9f81e219183bb85e9

The fresh full gate passed (90/90 unit/integration tests, 21/21 simulation tests, round seeds=200 with 0 violations), including the new six-process stale-takeover regression and expanded port-boundary crash sweep. The prior stale-read race is guarded in the normal path and crash coverage is materially expanded.

New P1 at `src/infrastructure/lock-file.ts:109-129`: a real process killed after `mkdir(kitchen.lock.guard)` but before writing its pid leaves an empty guard. `recoverDeadGuard` returns when the pid file is missing and never removes that ownerless directory. Two fresh processes each exhausted acquire attempts and returned `held` naming a confirmed-dead lock owner. Further restarts cannot recover this state. This violates crash-at-any-point restart takeover; the crash criterion remains open.

Saved reproducible evidence: `F:/MyWork/tkitchen/.verification-evidence/qa-07-rereview/report.md`, `guard-crash.mjs`, `guard-crash-result.json`, and `verify.log` in the same directory. The probe baseline acquires the same dead-pid lock successfully without the guard crash. No source files edited. Guard publication/recovery repair and a real-process crash regression remain for engineering, followed by independent re-review.

## Repair round 2 (eng-07, 2026-11-24)

Fixed qa-07 re-review P1: the takeover guard is no longer an `mkdir` directory whose pid is published in a second step. The guard is now a file published atomically the same way as the lock itself (complete per-pid temp file hard-linked into place), so a guard never exists without its owner pid; a crash before the link leaves no guard, and a crash after it leaves a complete pid that dead-owner recovery can judge. Recovery also clears ownerless guards: a guard whose pid file is missing or invalid is claimed by atomic rename once it is older than the 1 s write grace, verified again under the claim, and removed recursively (which also clears an orphan guard directory left by the old format), while a guard naming a live pid is restored and never stolen. Acquire retries now pause briefly between takeover attempts so a fresh orphan crosses the grace age within one acquire call instead of spinning out. Regressions in `tests/infrastructure/lock-file.test.ts`: dead guard pid recovered, ownerless guard directory recovered, a successor process acquires when the guard owner was killed with no pid published, and a live-pid guard is not stolen. The saved qa-07 guard-crash probe can no longer create the window (its mkdir hook never fires). Evidence: `.verification-evidence/eng-07-repair2-report.md`. Full gate observed: `npm run verify` exit 0 (94/94 tests, sim 21/21, 200 round seeds 0 violations). Ready for qa-07 re-review.

### qa-07 repair round 2 re-review (2026-11-24)

verdict: fail
commit:bb5ac2019389ec9039e115a97072e8075acdb483

The ownerless-guard P1 is fixed. A new real-process probe killed takeover workers before and after guard publication and after the recovery claim rename, and exercised fresh and aged ownerless guards; a successor acquired in all 8 scenarios, including a fresh ownerless guard directory inside one acquire call (1065 ms). The fresh full gate passed (94/94 tests, sim 21/21, 200 round seeds 0 violations), and the original stale-read probe no longer reproduces (second contender held).

New P1 at `src/infrastructure/lock-file.ts:155-165`: `recoverGuard` judges a guard pid dead, then `claimTo` renames whatever is at the guard path when the rename runs. A delayed recoverer can rename a successor's newly published live guard, leaving a guard-less window a third process enters beside the first; the live-guard restore then fails EEXIST and unlinks the first holder's guard. Two processes (97800, 105516) both returned `acquired` while both alive, reproduced twice. This breaks single-writer without any crash, so the crash/restart and second-serve criteria cannot close.

Evidence: `F:/MyWork/tkitchen/.verification-evidence/qa-07-repair2-review/report.md`, with `guard-crash2.mjs` (recovery scenarios, all pass), `guard-double-recovery.mjs` (the two-winner schedule), both result files, reruns of the two saved probes, and `verify.log` in the same directory. No source files edited. Guard recovery needs an identity-checked claim or ownership re-verification before lock deletion, plus a forced three-process regression, followed by independent re-review.

## Repair round 3 (eng-07, 2026-11-24)

Fixed qa-07 repair-round-2 P1 by removing the guard file entirely. Stale takeover is now authorized by a takeover claim at `kitchen.lock.takeover`, published atomically by hard link with the judged stale lock identity (inode, mtime, size, content digest). Only the claim winner may delete the lock, and only after re-reading the lock identity and finding it unchanged; a changed identity deletes nothing. Dead or ownerless claim recovery is itself gated by a recovery ticket named for the exact pid judged dead, won atomically before any deletion and re-verified after winning, so a delayed recoverer cannot move a successor's claim. Regressions in `tests/infrastructure/lock-file.test.ts` with a new IPC-paused fixture (`tests/fixtures/lock-schedule-worker.mjs`) force the delayed stale-read schedule and the delayed takeover-recovery schedule across real processes and require exactly one winner; dead and ownerless claim recovery and the live-claim no-steal case are covered, and the six-process ten-round takeover regression still passes. The saved `lock-race` probe reports `singleWriterViolation: false` and `guard-crash2` passes all 8 scenarios; the old `guard-double-recovery` probe times out because its checkpoints wait for a guard file the adapter no longer creates. Evidence: `.verification-evidence/eng-07-repair3-report.md`. Full gate observed: `npm run verify` exit 0 (94+2 tests: 96/96, sim 21/21, 200 round seeds 0 violations). Ready for qa-07 re-review.

### qa-07 repair round 3 re-review (2026-11-24)

verdict: fail
commit:b38e589520010560315abdead86db94bfb1f64cc

New P1 at `src/infrastructure/lock-file.ts:183-202`: `clearDeadTicket` treats a missing takeover claim as an aged ownerless one, so a delayed recoverer wins the `recover-invalid` ticket, re-reads `null`, and deletes a successor's newly published live claim. A forced two-process probe reproduced both processes returning `acquired` while both alive in 3 of 3 runs. Evidence: `F:/MyWork/tkitchen/.verification-evidence/qa-07-repair3-rereview/report.md`. Identity-checked claim deletion covering the absent and ownerless cases, plus a forced real-process regression, remain for engineering.

## Repair round 4 (eng-07, 2026-11-24)

Fixed qa-07 repair-round-3 P1: `clearDeadTicket` now judges a ticket snapshot (pid plus inode, mtime, size, and content digest). A missing claim is not a ticket: the clearer returns at once and deletes nothing. An existing dead or ownerless claim is deleted only after winning a recovery ticket named for the judged pid or judged identity key and re-reading the identical snapshot key. Takeover cleanup deletes the claim only when it still names this process. Also applied the report's P2 hardening: `release` checks the lock pid before renaming anything. Regression: a forced missing-claim recovery schedule in `tests/infrastructure/lock-file.test.ts` (recoverer and publisher modes in `tests/fixtures/lock-schedule-worker.mjs`, adapted from the QA probe) requires exactly one winner; the saved QA probe now times out because its checkpoints target the removed schedule. Evidence: `.verification-evidence/eng-07-repair4-report.md`. Full gate observed: `npm run verify` exit 0 (97/97 tests, sim 21/21, 200 round seeds 0 violations). Ready for qa-07 re-review.

### qa-07 repair round 4 re-review (2026-11-24)

verdict: pass
commit:77252202917945757d0b8d5bece3647c69d61c27

The round-3 P1 is closed at its root. An adapted forced probe replayed the exact missing-claim schedule: the recoverer now judges the claim absent, wins its own claim (checkpoint before unlinking the lock), the attacking publisher returns `held`, and exactly one process acquires with the lock naming it. A second forced schedule paused a clearer between the snapshot re-read and `discardAny` while a contender attacked; again exactly one winner. Two fresh independent critics found no two-writer schedule in the snapshot and ticket logic. The fresh full gate passed on my own run (97/97 tests, sim 21/21, 200 round seeds 0 violations), a 7-scenario real-process crash sweep (including a kill after winning the new ownerless key-named ticket) all recovered, and the saved `lock-race` and `guard-crash2` probes reran clean; the round-3 probe times out because its checkpoints can no longer occur. All five acceptance criteria now hold, so the crash and restart checkbox is closed by this review.

One P2 remains, recorded for later hardening and not gating: nested recovery tickets lengthen the filename by one `.recover-<pid>` per level, so a fabricated chain of 18 dead tickets makes `acquire` throw ENOENT until an operator deletes the ticket files. Reaching that state through crashes alone needs roughly 15 to 18 consecutive crashes in the publish-to-cleanup window with no successful acquire between (one success unwinds the whole chain, proven at depth 5). Safety never breaks and the store stays consistent.

Evidence: `F:/MyWork/tkitchen/.verification-evidence/qa-07-repair4-rereview/report.md`, with `claim-race2.mjs` (both forced schedules, one winner each), `claim-crash-sweep.mjs` (7 scenarios), `ticket-chain.mjs` (the P2), reruns of the prior probes, and `verify.log` in the same directory. No source files edited. Issue 07 is ready to close; eng-08 can proceed.

### qa-07 repair round 3 re-review (2026-11-24)

verdict: fail
commit:b38e589520010560315abdead86db94bfb1f64cc

The fresh full gate passed (96/96 tests, sim 21/21, 200 round seeds 0 violations), all forced crash windows in the new claim design recover, and both saved prior probes stay clean. The round-2 delayed-recoverer schedule is fixed for a claim file that exists and names a dead pid.

New P1 at `src/infrastructure/lock-file.ts:183-202`: `clearDeadTicket` treats a missing claim file as an aged ownerless one (`readTicketPidAt` returns `null` on ENOENT and `isFresh` returns `false`), wins the `recover-invalid` ticket, re-reads `null` while the path is still absent, then `discardAny` deletes whatever sits at the claim path when it runs. A successor's claim published between the re-read and the delete is removed under its live owner; both processes then pass the identity check against the same stale lock and both return `acquired` while both alive (86732, 96112), reproduced three times. Absence is not an identity, so the recovery ticket cannot protect a file that does not exist yet. This breaks single-writer without any crash; the second-serve and crash/restart criteria cannot close.

Evidence: `F:/MyWork/tkitchen/.verification-evidence/qa-07-repair3-rereview/report.md`, with `claim-recovery-race.mjs` (the two-winner schedule, 3 result files), `claim-crash-sweep.mjs` (6 crash and recovery scenarios, all pass), reruns of `lock-race` and `guard-crash2`, and `verify.log` in the same directory. A latent P2 in `release()` (renames the lock before checking ownership; unreachable from current callers) is recorded in the report as hardening only. No source files edited. Claim deletion needs to be identity-checked for the absent and ownerless cases too, plus a forced real-process regression for this schedule, followed by independent re-review.
