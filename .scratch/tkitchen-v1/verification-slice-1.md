# Verification: tkitchen v1, slice 1 (issues 01-09)

## Acceptance brief

## Slice 1 — tkitchen v1, git first: acceptance brief

**Before this slice:** nothing ran. There was no package, no CLI, and no store. Stacked branches went stale silently.
**After this slice:** `tkitchen round`/`serve` watch each configured repo, resolve every pushed branch's base (config → PR → reflog → reflog tip, or `needs_base`/`ambiguous`), and record a Base moved Trigger when a base with children moves. `tkitchen notices` shows who is behind, and `tkitchen export` hands the Triggers to aiNho. A sign-in task keeps `serve` running.
**Tier:** Tier 1 for a CLI: the real `tkitchen` process against real git repos and a real SQLite store. Each case gets its own temp world. Only `gh` is a fake on `PATH`, because `gh pr list --json` is the production boundary to GitHub. Unit, contract, and DST suites are supporting evidence.

> Retrospective: this slice had no trek **Slice outcomes** entry. The scenarios below are rebuilt from the acceptance criteria of issues 01-09 and the ledger decisions D-001…D-010.

```gherkin
Feature: tkitchen v1 watches stacked branches and says who is behind

  # ✅ VERIFIED — 17/17 checks PASS; Jev: VERIFIED (supports 0.92)
  Scenario: Config bases, baseline, push, quiet rerun, catch-up, read-only
    Given origin with main, A←main, F←A, C←main, B←C, D←C, config bases for all, C already 1 ahead of B and D
    When tkitchen round runs, a teammate pushes 1 commit to C, round runs again, then again with no push, then B merges C
    Then the baseline lists B and D behind 1 with 0 events; after the push B and D are behind 2 with 1 event (threads git:x:B, git:x:D) and 2 dispositions; the quiet rerun adds no rows; B drops out of notices (up_to_date); origin refs are identical before and after round; a bad config path exits 2 naming repos[0].path

  # ✅ VERIFIED — 7/7 PASS; Jev: VERIFIED (supports 0.89)
  Scenario: Automatic base from reflog, needs_base, history
    Given no config bases; B created by `checkout -b B origin/C` and E by `git branch E <C oid>` in the watched clone; G created in another clone
    When round, a push to C, round
    Then B is behind C (evidence reflog), E is behind C (reflog-tip), G is needs_base with the hint `add "bases": { "G": "<base>" } to …config.json`; --history shows 1 Trigger with dispositions git:x:B, git:x:E; adding bases {G:C} resolves G (explicit)

  # ✅ harness 11/11 PASS (after the FB-3 fix, run 20261124-rv-pr-base); Jev: INCONCLUSIVE after the fix (supports, best confidence 0.56-0.61 across 3 packets; it was VERIFIED 0.80 before the fix)
  Scenario: GitHub PR targets via gh
    Given feature-2 pushed from a teammate clone, fake gh returning PR feature-2 → feature-1
    When feature-1 moves; the PR is retargeted to main with no push; gh fails (FAKE_GH_FAIL=1) after another push; a fork PR and conflicting PRs are added
    Then feature-2 is behind feature-1 (evidence pr); its base becomes main without a push; the gh failure exits 1 with the full store snapshot unchanged and lastError set, and the next round records the move with the error cleared; the fork PR adds no base; config-vs-PR is ambiguous/explicit_pr_mismatch; two PRs from one head is ambiguous/multiple_prs

  # ✅ VERIFIED — 5/5 PASS; Jev: VERIFIED (supports 0.93)
  Scenario: An unreachable remote leaves the store untouched
    Given B←C behind-tracking, a teammate push to C
    When the watched clone's origin URL points at a missing path and round runs, then the URL is restored
    Then round exits 1, the event/repo_heads/branch_state snapshot is unchanged, and lastError is set; the next round exits 0, B is behind 1, and the error is cleared

  # ✅ harness 9/9 PASS (after the FB-1/FB-2 fixes, run 20261124-rv-serve-lock); Jev: INCONCLUSIVE after the fix (supports, best confidence 0.69-0.71 across 3 packets; it was VERIFIED 0.87 before the fix)
  Scenario: Serve loop and single-instance lock
    Given serve started with roundMinutes 0.05 (3 s)
    When a second serve, a round, and round --force are tried; a teammate pushes to C; serve is killed and a new serve starts
    Then kitchen.lock names the first pid; the second serve exits 1 "already running (pid N)"; round exits 1; --force exits 2; B shows behind 1 with no user action and lastCompleteAt advances; the killed serve leaves a dead-pid lock, and the new serve takes it over

  # ✅ VERIFIED — 6/6 PASS; Jev: VERIFIED (supports 0.81, after adding the raw NDJSON to the evidence)
  Scenario: Export for aiNho (tkitchen.export/1)
    Given an empty store, then 3 Base moved Triggers from real rounds, then a 4th
    When export --json, export --json --after <cursor>, export with a changed-id cursor, export with --after not-base64!
    Then header,end events:0; header(reset:false),seq 1,2,3,end; only seq 4; reset:true from seq 1; exit 2 with empty stdout; no outcome/status/behind_by/oid/consumer keys

  # ✅ VERIFIED — 7/7 PASS; Jev: VERIFIED (supports 0.91)
  Scenario: Windows sign-in task scripts
    Given task name tkitchen-verify
    When install-task.ps1 -Export <run>\task.xml and uninstall-task.ps1 run
    Then the XML has 1 LogonTrigger and 0 BootTrigger, node.exe running "…\src\cli\tkitchen.ts" serve, and IgnoreNew; schtasks /Query fails (not registered); uninstall exits 0
```

- **Evidence:** `bash .verification-skills/verify-tkitchen/scripts/journeys/<journey>.sh`. Results are in `.verification-evidence/verify-tkitchen/20261124-163835-*` (pr-base: `20261124-163835b-pr-base`), each with `checks.log`, `transcript.log`, `kitchen.db`, and `jev.json`.
- **What this proves:** a user running the real CLI on Windows with Node 26.3 sees exactly these notices, exit codes, store rows, and export lines.
- **What this does not prove:**
  - Real `gh` against real GitHub repos.
  - A real sign-in launch.
  - Node 22.22 on the work laptop.
  - Real-scale round timings (RB-011).
  - All of these are issue 10 (HITL).
  - Git timeouts (as opposed to an unreachable remote), fetch-after-ls-remote failures, force-push repeats, and deletions are proven only in tests and the DST sweep (see Supporting evidence), not driven by hand.

### Review
- Spec — lock recovery-ticket names grow with nesting depth; at 18 dead tickets `acquire` throws ENOENT (`src/infrastructure/lock-file.ts:207-215`) → FB-1, verified.
- Standards — the `oxlint-disable tkitchen/no-comments` header in `src/application/export.ts:1` → ruled out: issue 09 line 31 and issue 02 line 33 prescribe it.
- Standards — possible Duplicated Code in `src/infrastructure/lock-file.ts` → accepted by the user → FB-2, verified.
- Standards — possible Data Clumps in `src/application/round.ts:138-162` → not picked by the user (treated as dismissed).
- Standards (seen while driving) — `gh` spawned with `shell: true` on Windows → accepted by the user → FB-3, verified.
- Fix-diff review (regressions only) — if the post-acquire dead-ticket sweep (`src/infrastructure/lock-file.ts`, `clearDeadRecoveryTickets`) throws, for example `readdir` EACCES, `acquire` rejects after it has already written the lock. Not an acceptance-criterion break: `serve`/`round` exit 1, the lock then names a dead pid, and the next start takes it over. A best-effort sweep (catch and ignore) removes the wart → the user chose to fix it → FB-4, fixed (reproduced with an injected `readdir` failure).

### Feedback
- FB-1 lock recovery-ticket chain → verified (fix now, user)
- FB-2 duplicated lock parsing → verified (fix now, user)
- FB-3 gh through a shell: DEP0190, gh can outlive its timeout → verified (fix now, user)

### Not covered by this slice
- Real gh, real sign-in, Node 22.22, measured workload → issue 10 (HITL, `ready-for-human`)
- aiNho importer, other producers (forge CI, tstack, workspace), notice delivery to people (K10) → out of scope for v1 (PRD non-goals)

### Try it yourself
- `bash .verification-skills/verify-tkitchen/scripts/journeys/round-and-notices.sh`. Or build your own world: `node .verification-skills/verify-tkitchen/scripts/vt.mjs new <dir>`, then use the `branch`, `commit`, `prs`, and `kt <dir> -- notices` verbs (see `.verification-skills/verify-tkitchen/SKILL.md`).

## Target checkout

- Path `F:/MyWork/tkitchen`, branch `main`, HEAD `c8928eb` (Base `8308f71`, 13 commits). Uncommitted changes: `.scratch/` planning files only, plus the new `.verification-skills/verify-tkitchen/` added by this session. No product code is uncommitted.
- Environment: Windows 11, Node v26.3.0, git 2.56.1. The extra worktree `F:/MyWork/worktrees/tkitchen/tstack-50515df6` sits at Base `8308f71` and holds no slice commits.

## Requirements → recipes → results

| Scenario | Issues / decisions | Recipe | Harness | Jev | Status |
|---|---|---|---|---|---|
| Config bases … read-only | 01; D-003, D-004, D-005, D-008, D-009; RB-002, RB-003, RB-007 | `journeys/round-and-notices.sh` | hard_pass 17/17 | VERIFIED (rule 6, supports 0.92) | passed |
| Automatic base | 04; D-006 | `journeys/automatic-base.sh` | hard_pass 7/7 | VERIFIED (0.89) | passed |
| PR targets | 05; D-007; RB-001, RB-006 | `journeys/pr-base.sh` | hard_pass 11/11 | VERIFIED (0.80) | passed |
| Unreachable remote | 06; D-008 | `journeys/git-failure.sh` | hard_pass 5/5 | VERIFIED (0.93) | passed |
| Serve + lock | 07; D-001; RB-005 | `journeys/serve-and-lock.sh` | hard_pass 9/9 | VERIFIED (0.87) | passed |
| Export | 09; D-010; RB-009 | `journeys/export.sh` | hard_pass 6/6 | first INCONCLUSIVE (0.73, low confidence); VERIFIED (0.81) after adding the raw NDJSON | passed |
| Sign-in task | 08; D-001, A-002 | `journeys/sign-in-task.sh` | hard_pass 7/7 | VERIFIED (0.91) | passed |

Commands are run from the repo root. A first pr-base run had 1 FAIL: the journey expected `behindBy=1`, but `feature-1` had received 2 pushes since branching. The journey's expectation was corrected to 2, and the rerun is `163835b` (11/11).

## Supporting evidence (Tier 2, DST)

- `npm run verify` at c8928eb: exit 0. Lint, typecheck, and structure (19 modules) pass, 107/107 unit/CLI/contract tests, 21/21 sim tests, `round seeds=200 violations=0 realGitCalls=0`. Log: `.verification-evidence/indicate-v1/verify-head.log`.
- Broad DST sweep `SIM_SEEDS=2000 npx vitest run --config vitest.sim.config.ts`: exit 0, `round seeds=2000 violations=0 realGitCalls=0 exportResets=2246`, 21/21. Oracles: ground-truth, no-duplicates, no-tx-across-port, incomplete-changes-nothing, progress, single-writer, export-exactly-once. Log: `.verification-evidence/indicate-v1/sim-2000.log`. Draft verdict hard_pass with seed count 2000. No design model (`model.mjs`) exists for this slice, so trace conformance does not apply.
- Failing at Base: none. Base `8308f71` has no product code or tests.

## Drift

- **Adjustment:** issue frontmatter statuses were never set to `closed`. 01 and 10 read `ready-for-human`; 02-09 read `ready-for-agent`. All criteria in 01-09 are ticked, and each has a QA pass. They should be set to `closed` when the slice closes.
- **Adjustment:** issue 06 "Force-push repeat" expects 3 `event` rows. Under D-005 (id = repo, base, newHead), X→Y→X→Y stores 2 rows. The engineer and QA both recorded this. Code follows the ledger. This is a wording error in the criterion, not a code gap.
- **Adjustment:** `round_status` table, watched-set descendant exception, and fork PRs ignored (coverage-ledger F-PRD-1..4). These were refinements made while writing the PRD, and they are implemented as written.
- No missing, contradicted, or reversed decisions were found by the Spec review.

## Review findings

The review ran in slice mode against Base `8308f71` in two read-only sub-agents. Both were given the full patch file and noted that their review was limited and not exhaustive (no shell). Outcomes are listed under **Review** in the brief.

## Re-verify (2026-11-24)

Code: HEAD `c8928eb` plus uncommitted fixes in `src/infrastructure/lock-file.ts`, `src/infrastructure/github/github-forge.ts`, `tests/fixtures/fake-gh/fake-gh.mjs`, `tests/infrastructure/lock-file.test.ts`, and the new `tests/infrastructure/gh-timeout.test.ts`. Patch: `.verification-evidence/indicate-v1/reverify/fix.patch`.

- **Judges touched by the fixes:** the test edits only add things (one new lock test, one new gh-timeout test, two opt-in fake-gh env settings). No existing assertion changed. The probes in `evidence/slice-1-probes/` were written by indicate before the fixes and are unchanged.
- **Contracts:** every Proof fails with `src/` stashed (pre-fix) and passes with the fixes. FB-1, FB-2, and FB-3 → verified (see the feedback file). Counts: 3 verified, 0 reopened, 0 new items.
- **Must not break and standard checks:** 28/28 targeted tests, `serve.sim` 4/4. All 7 journeys pass: 62/62 checks (`20261124-rv-*`). `npm run verify` exits 0: 109/109 tests, sim 21/21, 200 seeds, 0 violations.
- **Jev on the affected scenarios:** three packets per scenario (initial; mapping plus raw calls; everything combined). Serve-and-lock got supports 0.71 / 0.43 / 0.69, and PR-base got supports 0.61 / confounded 0.35 / supports 0.56. All INCONCLUSIVE (rule 3, low confidence). The harness verdict is hard_pass, and the identical journeys were Jev-VERIFIED before the fixes. Per the gate these two scenarios are not PASS until better evidence clears Jev or the user accepts the harness evidence.
- **Fix-diff review:** one finding, the sweep can make a successful acquire reject. It is listed under Review as a judgement call because it breaks no criterion.

## Acceptance (2026-11-24)

The user accepted the slice, including the serve-and-lock and PR-base scenarios on the harness evidence (Jev INCONCLUSIVE after the fixes; see Re-verify). Their words: "accept it and live verify this".

## Live verification (2026-11-24, home machine DESKTOP-LJB4PL8)

Real CLI at `c8928eb` plus the FB-1..3 fixes. Real `gh` (account `thonghuynhm`), real GitHub remotes over SSH, and a separate kitchen home (`.verification-evidence/live/20261124-175228/home`, not `~/.tkitchen`). Repos: `F:/MyWork/my-pi` (11 heads), `F:/MyWork/aiLau` (2 heads), `F:/MyWork/tstack` (42 heads). Raw log: `live.log`, timings `timings.txt`.

| Check | Result |
|---|---|
| `round` on my-pi, aiLau | exit 0 both; `lastCompleteAt` set, `lastError` null |
| `round` on tstack | exit 1; `lastError` = `gh pr list failed: GraphQL: Could not resolve to a Repository with the name 'thonghuynh1/tstack'`; `lastCompleteAt` null (nothing recorded, as D-007/F-003 require) |
| `notices` | 3 real my-pi branches `needs_base`, each with the config hint; no false `behind` |
| `export --json` | header (`tkitchen.export/1`, machine `DESKTOP-LJB4PL8`) plus end `events:0`; no Trigger yet, because no base moved during the run |
| `DEP0190` on stderr | 0 occurrences (FB-3 holds live) |
| User's repos | local branches and `git status` identical before and after; only `origin/*` tracking refs move (normal fetch) |
| `serve` (roundMinutes 0.5) | lock names its pid; a second `serve` prints `already running (pid 21192)`; cycles completed at 10:55:32/37 and 10:56:40/46 (about 65 s apart: 30 s sleep plus about 35 s of Rounds); tstack fails each cycle without stopping the loop; stopped by killing only the pid this run started |
| Dead-pid takeover | `serve` killed with `taskkill /F` left a lock naming pid 76652; a new `serve` took it over and the lock named pid 59020 within 6 s |

Workload (RB-011, measured, not a gate): first and quiet Round durations were my-pi 12.3 s / 9.4 s, aiLau 8.9 s / 5.4 s, and tstack 4.2 s (fails at gh). The PRD expected 3-4 s quiet; the measured times are higher. The process tree shows one `git merge-base --is-ancestor` per branch pair.

Not covered live: registering the real sign-in task and signing out/in (a persistent change to the machine; left to issue 10); Node 22.22 on the work laptop; a real base move producing a live Trigger.
