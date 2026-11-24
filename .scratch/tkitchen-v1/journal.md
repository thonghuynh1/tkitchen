# Journal: tkitchen v1

## Slice 1 — tkitchen v1, git first: round, notices, serve, export (issues 01-09)

### What was built
- [01 Walking skeleton](issues/01-walking-skeleton-round-and-notices.md): built
- [02 Quality gate](issues/02-quality-gate-lint-and-structure.md): built
- [03 DST harness and oracle](issues/03-dst-harness-and-ground-truth-oracle.md): built
- [04 Automatic base from reflog](issues/04-automatic-base-from-reflog-and-needs-base.md): built
- [05 GitHub PR targets via gh](issues/05-github-pr-targets-via-gh.md): built
- [06 Round fault tolerance](issues/06-round-fault-tolerance-under-dst.md): built
- [07 Serve loop and lock](issues/07-serve-loop-and-single-instance-lock.md): built
- [08 Sign-in launch task](issues/08-sign-in-launch-task.md): built
- [09 Export for aiNho](issues/09-export-for-ainho.md): built
- [10 HITL smoke](issues/10-hitl-smoke-on-both-machines.md): not in this slice (human, both machines)

### Drift
- Issue frontmatter statuses were never set to `closed` → set to `closed` at this close.
- Issue 06 "Force-push repeat" expects 3 `event` rows; D-005 gives 2 for X→Y→X→Y. Code follows the ledger; the criterion is misworded.

### Review
- Spec — lock recovery-ticket names grew with nesting, so about 18 dead tickets blocked startup → FB-1, verified.
- Standards — duplicated pid parsing and identity reading in `lock-file.ts` → FB-2, verified.
- Standards — `gh` run with `shell: true` on Windows (DEP0190 on every Round, gh could outlive its timeout) → FB-3, verified.
- Standards — `export.ts` no-comments suppression → ruled out (issues 02 and 09 prescribe it).
- Standards — data clumps in the Round collectors → not picked by the user.
- Fix-diff review — the post-acquire sweep can make a successful `acquire` reject if it throws; not a criterion break (the process exits and the dead lock is taken over) → FB-4, fixed after the close at the user's request.

### Verification and acceptance
- Report: [Slice 1 verification](verification-slice-1.md)
- Acceptance brief: 7 scenarios. Config bases, automatic base, unreachable remote, export, and sign-in task are VERIFIED (harness plus Jev). Serve-and-lock and PR-base pass the harness, but Jev was INCONCLUSIVE after the fixes; the user accepted them on the harness evidence.
- Required checks: `npm run verify` exit 0 (109 tests, sim 21, 200 seeds); broad DST sweep 2000 seeds 0 violations; 7 journeys, 62/62 checks; live run on real repos with real gh (see the report's § Live verification).
- Jev: `jev.json` in each `.verification-evidence/verify-tkitchen/20261124-*` run dir.
- Feedback: [Slice 1 feedback](feedback-slice-1.md) — 3 verified, 0 ticketed, 0 residual.
- Waived or unchecked: Jev on serve-and-lock and PR-base after the fixes; the user accepted the harness evidence, so Jev's second check of those two is still missing. Real sign-in, Node 22.22, and a live base move are left to issue 10.
- User reaction: "accept it and live verify this".

### What surprised us
- The `gh` account on this machine (`thonghuynhm`) cannot see the private `thonghuynh1/*` repos (tstack, aiNho, pi-selftools, tproxy). By D-007/F-003 every Round on those repos is incomplete, so they never get any notice, not even from reflog evidence.
- Round cost grows with the square of the branch count (one `git merge-base` per pair). It is fine at 11-42 heads (about 10 s), but repos like orca (21,117 heads) or cua-research (4,229) would never finish a Round.
- Quiet Rounds measured 5-9 s on small repos, against the 3-4 s the PRD expected.
- Jev scored the same journey evidence VERIFIED before the fixes and INCONCLUSIVE after, across three packet shapes.

### What we learned
- An incomplete-forever repo is invisible except as `lastError` in `notices --json`; the human `notices` output does not show it. Worth surfacing.
- Real-scale workloads need a cap or a cheaper watched-set computation before tkitchen watches big repos.
- The verification skill `.verification-skills/verify-tkitchen/` now exists; reuse it for later slices.

### Map updates
- No `map.md` for this feature (planned as PRD plus issues). Follow-ups proposed, not yet ticketed:
  - Parked: show repos whose last Round failed in the human `notices` output.
  - Done: Round cost from pairwise ancestry → issue 12.
  - Done: private SSH-only repos → issue 11 (`"forge": "none"`), instead of changing the `gh` sign-in.
  - Done: best-effort post-acquire sweep → FB-4.

## After slice 1 — issues 11 and 12 (2026-11-24)

### What was built
- [11 SSH-only repos: forge none](issues/11-ssh-only-repos-forge-none.md): built. A repo can set `"forge": "none"`; the kitchen never runs `gh` for it, and bases come from config and reflog. D-007 amended in the ledger.
- [12 Ancestry per branch](issues/12-ancestry-per-branch.md): built. One `git for-each-ref --contains` per branch replaces one `merge-base` per pair.

### Verification and acceptance
- Issue 11: `tests/cli/forge-none.test.ts` 3/3, with a `github` control in the PR test. Live on tstack over SSH: Round exit 0, `lastError` null, 9 notices.
- Issue 12: git contract test for real repo and sim; `npm run verify` exit 0 (114 tests, 200 seeds, 0 violations); 2000-seed sweep with the new call in the fault set, 0 violations. Live on tstack: 85-89 s → 11.0 s, notices identical (9/9).
- Waived: the "well under 10 s" target. The user accepted 11 s.
- User reaction: "okay go with A" (issue 12), "okay let accept it".

### What surprised us
- After the ancestry fix the remaining cost is process start-up on Windows (about 67 ms per git call), and 123 of 174 calls are `git reflog`.
- Notices exist only for stacked branches whose base moved, so the first forge-none test fixture produced no notice at all.

### Map updates
- Parked: read the reflog once per branch, or straight from `.git/logs`, to cut about 120 git calls per Round on tstack (about 11 s → about 4 s).
- Parked: `gh pr list --limit 200` silently truncates repos with more open PRs; raise the cap and warn.

### Close (2026-11-24)
- FB-4 closed at `fixed` without a separate re-verify, by the user's choice. No report published to tstack ("no need to report").
- User reaction: "let close this slice".
