---
repo: F:/MyWork/tkitchen
status: closed
type: AFK
covers: [DEC-012 (world, doubles, runner, ground-truth oracle, contract suite for GitRepo), US-006, RB-002, RB-004]
---

## Parent

`.scratch/tkitchen-v1/PRD.md`

## What to build

Deterministic simulation testing for the Round from issue 01: a seeded world, an in-memory git remote (`SimRemote`), developer actors, scheduler-controlled port calls, the ground-truth, no-duplicate and no-transaction-across-a-port oracles, a seed runner with `SIM_SEED` replay, and a contract suite proving `SimRemote` behaves like the real git adapter. A failing run prints its seed; the seed replays the same trace.

## Implementation map

**Precedent**: `F:/MyWork/tstack/.scratch/dst/overview.md`, `F:/MyWork/tstack/tests/sim/{world,doubles,actors,faults,oracles,runner,scenarios}/`, `F:/MyWork/tstack/vitest.sim.config.ts` (GROUND-011). Deliberate difference: tstack fakes `Date`/timers globally; tkitchen injects them through the ports from issue 01 (`Clock`, `Scheduler`, `Random`, `Ids`), so **no global fakes**.

**Consumes from issue 01**: `src/application/ports.ts` (`GitRepo`, `Config`, `Clock`, `Scheduler`, `Random`, `Ids`, `PortError`), `src/application/round.ts` (a function taking those ports plus the store), `src/infrastructure/sqlite/` (store opened on a path), `src/infrastructure/git/` (real `GitRepo`). The sim composes the real round and real store with sim ports.

**Files**:
- `vitest.sim.config.ts`: extends `vitest.config.ts`, `include: ["tests/sim/**/*.sim.ts"]`; `package.json` script `"test:sim": "vitest run --config vitest.sim.config.ts"`.
- `tests/sim/world/`: `rng.ts` (seeded PRNG, e.g. mulberry32), `clock.ts` (virtual ms clock implementing `Clock`/`Scheduler`), `trace.ts` (`{ step, virtualMs, event, outcome }[]` and a sha256 hash), `determinism.ts` (run a seed twice, compare hashes).
- `tests/sim/doubles/sim-remote.ts`: `SimRemote` implements `GitRepo`: commits as `{ oid, parents }` with deterministic oids from `Ids`, branches → oid, a `HEAD` default branch; `lsRemoteHeads`, `fetch` (copies remote heads into a "fetched" view the ancestry queries use, so a missing fetch is observable), `isAncestor`, `countBehind`. Every method returns a promise the scheduler resolves (yield point), so the world can interleave between calls.
- `tests/sim/doubles/sim-config.ts`: in-memory `Config` with `bases` editable by actors.
- `tests/sim/actors/developer.ts`: seeded actions: `commit+push <branch>`, `branch <new> from <base>` (and add it to config `bases`), `merge <base> into <child> + push`, `merge <child> into <base> + push`, `delete <branch>`.
- `tests/sim/oracles/`: `oracle.ts` (`{ id, kind: "safety" | "progress", check(world) → Violation[] }`), `ground-truth.ts`, `no-duplicates.ts`, `no-tx-across-port.ts`.
  - **ground-truth**: after each complete Round, for every branch the oracle computes from `SimRemote` + config (same Watched-set rule as the domain: not default, not ancestor of its base's head, not ancestor of a non-descendant pushed head) the expected `{ base, status, behindBy }`; it must equal `branch_state` exactly (no extra, no missing rows). The oracle computes ancestry from the commit graph directly, **not** by calling the domain functions.
  - **no-duplicates**: running the Round again with no world change adds 0 rows to `event` and `disposition`.
  - **no-tx-across-port**: the sim store wrapper records `BEGIN`/`COMMIT`; a port call starting while a transaction is open is a violation.
- `tests/sim/runner/loop.ts`: seed loop; `SIM_SEED=<n>` runs one seed; `SIM_SEEDS=<n>` (default 200) the batch; on a violation print `seed=<n> oracle=<id>` and the last 20 trace lines, then fail.
- `tests/sim/round.sim.ts`: the sweep: per seed, a random tree of 3-8 branches, 20-60 actor steps with a Round every few virtual minutes.
- `tests/sim/world.sim.ts`: determinism self-check.
- `tests/contract/git-repo.contract.ts` + `tests/contract/git-repo.test.ts`: one suite `(make: () => Promise<GitRepo & Scripting>)` run against `SimRemote` and against the real adapter on temp repos (bare origin + clone, built with real git in the test). Cases: `lsRemoteHeads` heads and `defaultBranch`; heads unchanged until `fetch` for ancestry; `isAncestor` true/false; `countBehind` 0, 1, 3.
- Store on a temp file under `TEMP`; real git and `gh` must not run inside `*.sim.ts` (the runner replaces the git runner with one that throws if called).

**Mechanics left to the implementer**: PRNG choice, actor weights, batch size within the 1-minute budget, trace formatting.

## Acceptance criteria

- [x] Sweep passes on the real Round
  - Run: `npm run test:sim`
  - Expected: exit 0; a summary line `round seeds=200 violations=0` (or the configured batch).
  - Fails when: the Round and the oracle disagree on any seed.
- [x] Same seed, same trace
  - Run: `npm run test:sim -- tests/sim/world.sim.ts`
  - Expected: seed 42 run twice → identical trace hash; seeds 42 and 43 → different hashes.
  - Fails when: anything reads real time or randomness.
- [x] A determinism leak is caught
  - Run: `npm run test:sim -- tests/sim/world.sim.ts` → `leak is detected`
  - Expected: a test double that mixes `Date.now()` into an oid makes the self-check report a hash mismatch.
  - Fails when: the self-check compares only final state.
- [x] Harness proof: the oracle catches a broken Round
  - Run: `npm run test:sim -- tests/sim/round.sim.ts` → `mutant: skip child-move recheck is caught`
  - Test: the test runs the sweep with a round variant that recomputes staleness only when a base moved (a test-only flag on the round's options, default off).
  - Expected: at least one seed fails `ground-truth`, and the failure output contains `seed=`.
  - Fails when: the oracle cannot see a stale `branch_state` row.
- [x] Replay a seed
  - Run: `SIM_SEED=7 npm run test:sim -- tests/sim/round.sim.ts`
  - Expected: exactly one seed runs; its trace hash equals the hash of seed 7 in the batch run.
  - Fails when: `SIM_SEED` is ignored.
- [x] No duplicates on a quiet re-run (RB-002)
  - Run: `npm run test:sim`
  - Expected: `no-duplicates` reports 0 violations across the batch.
  - Fails when: the Trigger id or `INSERT OR IGNORE` is broken.
- [x] No transaction across a port call (RB-004)
  - Run: `npm run test:sim -- tests/sim/round.sim.ts` → `mutant: write inside collect is caught`
  - Expected: a round variant that opens the transaction before `countBehind` calls fails `no-tx-across-port` with a seed.
  - Fails when: the store wrapper does not observe transactions.
- [x] SimRemote matches real git
  - Run: `npm test -- tests/contract/git-repo.test.ts`
  - Expected: every case passes for both `SimRemote` and the real adapter (two describe blocks, same case names).
  - Fails when: either implementation answers a case differently.
- [x] No real git inside a sim
  - Run: `npm run test:sim`
  - Expected: the throwing git runner is never called (a counter in the summary shows `realGitCalls=0`).
  - Fails when: the sim composes the real git adapter.

## Independent QA review (qa-03)

Verdict: fail. Reviewed HEAD `8308f71146fba6d5dc532e1c309e1c4bd632e432` plus the untracked implementation captured in `.verification-evidence/qa-03-manifest.json`.

- QA03-1: `SimWorld.throwingGitRunner` is never installed. A real git call injected into the simulated port path executed successfully while `runSeed(7)` reported `realGitCalls=0` and no violations. The no-real-git acceptance checkbox is reopened.
- QA03-2: The scheduler never runs developer actions at port yield points. Ten seeds exercised 505 actor actions and 12,291 port calls with zero actor actions during a Round. `VirtualClock.sleep()` resolves immediately and `runSeed()` serializes actor steps and complete Rounds.
- The full gate passed independently (40 unit/contract tests, 6 sim tests, 200 sweep seeds). Independent seed-7 single/batch replay passed. Those passing results do not cover the two gaps above.
- Evidence and rerunnable probes: `F:/MyWork/tkitchen/.verification-evidence/qa-03-review.md`, `qa-03-probes.test.mjs`, `qa-03-probes.log`, `qa-03-verify.log`, `qa-03-manifest.json`.

## Independent QA repair re-review (qa-03)

Verdict: fail. HEAD remains `8308f71146fba6d5dc532e1c309e1c4bd632e432`; reviewed artifact hashes are in `.verification-evidence/qa-03-rereview-manifest.json`.

- QA03-1 remains open: real git is now counted but not blocked. The installed callback does not throw; both new sim regression files deliberately execute real git. The specification requires a throwing replacement and no real git inside sims.
- QA03-2 is closed: unchanged independent probes observed 1,006 actor actions during Round intervals across ten seeds, and single/batch replay passed.
- QA03-3 is new: the revised ground-truth oracle computes ancestry and behind counts from the fetched cache. A no-op fetch after main advances persists `behindBy=0`/`up_to_date` even though graph truth is `behindBy=1`, and the oracle reports no violation. The independent retained probe reproduces this without concurrent actors.
- Full gate independently passed 40 unit/contract tests and 9 sim tests with a 200-seed sweep. Original probes passed 3/3; stricter specification probes failed 2/2.
- Fresh report: `F:/MyWork/tkitchen/.verification-evidence/qa-03-rereview.md`. Reproduce via `node --experimental-strip-types --test .verification-evidence/qa-03-rereview-probes.test.mjs` from the repo root. Source files were not edited.

## Independent QA final repair re-review (qa-03)

Verdict: pass. Reviewed HEAD `8308f71146fba6d5dc532e1c309e1c4bd632e432` plus the untracked implementation captured in `.verification-evidence/qa-03-rereview2-manifest.json`; all 47 reviewed file hashes remained unchanged through verification.

- QA03-1 closed: the actual default git runner rejects before process execution while a sim guard is installed. The unchanged strict probe passes. An independent process-fenced full sim sweep passed with zero git/gh launch attempts.
- QA03-2 remains closed: retained independent replay/interleaving checks passed, with 1,006 in-Round actor actions across ten seeds.
- QA03-3 closed: the oracle now uses observed oids and direct graph ancestry, not the fetched cache. The unchanged no-fetch probe gets the expected ground-truth violation for stored `behindBy=0` versus correct `behindBy=1`.
- Full gate independently passed 40 unit/contract tests, 10 sim tests, and a 200-seed sweep. The strict probes passed 2/2 and replay/interleaving checks passed 2/2. No source edits or merge were performed.
- Fresh evidence: `F:/MyWork/tkitchen/.verification-evidence/qa-03-rereview2.md`, with gate, strict-probe, replay, process-fence logs and reviewed hashes beside it.

## Blocked by

- Local: `01-walking-skeleton-round-and-notices.md` — provides the ports, `round.ts` with injected ports, the sqlite store and the real git adapter. Proof the edge is connected: the sweep imports `src/application/round.ts` and the contract suite imports `src/infrastructure/git/`; both fail to compile if those are missing or stubbed.
