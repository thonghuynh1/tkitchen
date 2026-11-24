# Coverage ledger: tkitchen v1

PRD: `PRD.md`. Base: tkitchen `8308f71146fba6d5dc532e1c309e1c4bd632e432` (2026-11-23). Lint snapshot: tstack `bfa26c76`.

## Baseline at Base

- Broad gate: none. The repo has no `package.json` or code at Base (GROUND-007), so `npm run verify` cannot run. Pre-existing failures: none possible. `/indicate` compares against an empty tree.
- Every verification command runs from `F:/MyWork/tkitchen`; none can run before issue 01 creates `package.json`.

## Decisions

| ID | State | Falsifying criterion |
|---|---|---|
| DEC-001 serve + lock | covered by issue 07 (process); launch task by issue 08 | 07 `Second serve refuses`, `round refuses while serve runs, no bypass`, `Stale lock is taken over`; 08 `Export writes the task XML` (LogonTrigger, not Boot) |
| DEC-002 package shape | covered by issue 01 | 01 `Runs on Node ≥22.19 without flags` |
| DEC-003 config | covered by issue 01 | 01 `Bad config is rejected without writing`; walking skeleton uses `bases` |
| DEC-004 schema v1 | covered by issue 01 | 01 `Store migration and dedupe` |
| DEC-005 Trigger id | covered by issue 01 | 01 `Trigger id recipe` |
| DEC-006 base rungs | covered by issue 04 (explicit, reflog, reflog-tip, needs_base, ambiguous, cycles) | 04 `Each rung`, `Ambiguity outcomes`, `Real reflog evidence end to end` |
| DEC-006 PR rung | covered by issue 05 | 05 `Teammate's branch gets its base from a PR` |
| DEC-007 gh every Round | covered by issue 05 | 05 `Retarget without a push`, `gh failure makes the Round incomplete`, `SimForge matches GitHubForge` |
| DEC-008 Round | covered by issue 01 (core); 06 (all-fault incomplete rule, deletes, repeats) | 01 walking skeleton + `child merge closes notice`; 06 `Fetch failure…`, `Force-push repeat…` |
| DEC-009 notices | covered by issue 01 (open rows, --json) ; hint + --history by 04 | 01 walking skeleton; 04 `needs_base with hint`, `--history` |
| DEC-010 export | covered by issue 09 | 09 all criteria |
| DEC-011 layers | covered by issue 02 (enforcement); layout created by 01 | 02 `Layer rule` |
| DEC-012 DST | covered by issue 03 (world, runner, oracles, contract suite) | 03 `Same seed, same trace`, `A determinism leak is caught`, `Harness proof` |
| DEC-013 lint | covered by issue 02 | 02 lint fixture criteria (floating promise, comment, magic number, switch, unsafe cast) |

Rows split by variant own one issue each: DEC-006 rungs (04) vs PR rung (05); DEC-009 open/json (01) vs hint/history (04); DEC-008 core (01) vs fault paths (06); DEC-001 process (07) vs launch (08).

## User stories

| ID | State | Criterion |
|---|---|---|
| US-001 (walking skeleton) | covered by issue 01 | `Walking skeleton: push to C marks B and D behind` |
| US-002 notice closes | covered by issue 01 (catch-up); leaving the watched set by 06 | 01 `A child that catches up closes its notice`; 06 `Deleted branch closes its notice` |
| US-003 automatic bases | covered by issue 04 (reflog, needs_base, ambiguous); other authors by 05 | 04 `Real reflog evidence`, `needs_base with hint`; 05 `Teammate's branch…` |
| US-004 runs on its own | covered by issue 07 (loop); 08 (task); 10 HITL real sign-in | 07 `Loop runs every repo each interval`; 10 `Sign-in launch` |
| US-005 export | covered by issue 09 | 09 `Full export`, `Resume after cursor` |
| US-006 seeded replay | covered by issue 03 | 03 `Replay a seed` |

## Required behaviors

| ID | State | Criterion |
|---|---|---|
| RB-001 incomplete on failure | covered by issue 05 (forge) and 06 (git): split by variant | 05 `gh failure makes the Round incomplete`; 06 `Git timeout makes the Round incomplete` |
| RB-002 no rows on re-poll | covered by issue 01 | 01 `Quiet re-run adds nothing`; 03 oracle `no-duplicates` consumes it |
| RB-003 first Round baseline | covered by issue 01 | 01 `First Round is a baseline` |
| RB-004 no tx across port | covered by issue 03 | 03 `No transaction across a port call` (mutant); 06 re-checks under faults |
| RB-005 single instance | covered by issue 07 | 07 `Second serve refuses`, `round refuses…`, `Stale lock…` |
| RB-006 PRs + config every Round | covered by issue 05 | 05 `Retarget without a push updates the tree` |
| RB-007 never writes repos | covered by issue 01 | 01 `Never writes to a repo` |
| RB-008 Node ≥22.19 | covered by issue 01 (here); HITL work laptop by 10 | 01 `Runs on Node ≥22.19 without flags`; 10 `Node 22.22 on the work laptop` |
| RB-009 export Triggers only | covered by issue 09 | 09 `Only Triggers leave the machine` |
| RB-010 verify gate | covered by issue 02 | 02 `Existing code passes the gate`, layer/env/budget criteria |
| RB-011 workload | HITL — issue 10 measures; DST batch < 1 min is a target in 03 | 10 `Workload` |
| RB-012 siblings unchanged | covered: no issue edits `F:/MyWork/aiNho`, `pi-selftools`, `my-pi`; every issue's `repo` is `F:/MyWork/tkitchen` | frontmatter of issues 01-10 |

## Edges

| Edge | State |
|---|---|
| aiNho imports export later | deferred/out of scope (K7, aiNho repo); contract owned by issue 09 |
| pi-selftools, herdr unchanged | covered by RB-012 row |
| Workload: repos per machine, round cost | HITL — issue 10 |
| Setup: both machines, Node ≥22.19, gh, git creds, sign-in task | HITL — issue 10; README by issue 08 |

## Blocking edges

| Edge | Producer output | Consumer proof |
|---|---|---|
| 01 → 02 | package.json, `src/` layout, env.ts | 02 `Existing code passes the gate` |
| 01 → 03 | ports, `round.ts`, sqlite store, git adapter | 03 sweep + contract suite compile against them |
| 03 → 04 | SimRemote, ground-truth oracle, contract suite | 04 `Sweep with reflog bases`, contract cases |
| 04 → 05 | `resolveBase` with `prTargets` slot | 05 `evidence: "pr"` criterion |
| 05 → 06 | Round with forge + `incomplete-changes-nothing` oracle | 06 sweep with git faults |
| 03 → 07 | virtual Scheduler, runner, oracles | 07 crash/restart criterion |
| 07 → 08 | `tkitchen serve` | 08 XML action asserts `tkitchen.ts serve` |
| 03 → 09 | sim world for export oracle | 09 sweep criterion |
| 05,06,07,08,09 → 10 | the whole v1 | 10 manual steps |

## Findings while writing the PRD and issues

- F-PRD-1 `round_status` table — **incorporated**. DEC-009/Risks promise "last complete Round time per repo" but DEC-004 named no home for it; added a fifth table, local, never exported. Owner: issue 01.
- F-PRD-2 Watched-set rule — **incorporated**. The vault rule "not merged into another pushed branch" drops A in the plan's own example (A's head is an ancestor of its child F). Refined to exclude descendants; the default branch comes from `ls-remote --symref` and is only a base. A child with no own commits is treated as merged until it gets one. Owner: issue 01; oracle mirrors it in 03.
- F-PRD-3 Fork PRs — **incorporated**. Verification F-005 named forks; v1 ignores `isCrossRepository` PRs. Owner: issue 05.
- F-PRD-4 Formal properties — **rejected as separate work**: the two promises named in the handoff (ground truth after complete Rounds; export exactly once) are DST oracles in 03/09, and no `.verification-skills/*-formal` skill exists in tkitchen; no TLA+ issue planned.

## Audit (plausible wrong implementations)

- Recompute staleness only on base moves → 01 `child merge closes notice`, 03 mutant.
- Advance `repo_heads` on forge failure → 05 criterion + mutant.
- Open the transaction before port calls → 03 mutant `write inside collect`.
- Derive notices from latest Disposition → 06 `Force-push repeat`.
- Lint config missing typeAware → 02 floating-promise fixture.
- Export includes dispositions → 09 `Only Triggers leave the machine`.
- `round --force` bypass → 07 rejects the flag.

Coverage gaps: None.
