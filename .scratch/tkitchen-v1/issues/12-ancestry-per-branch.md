---
repo: F:/MyWork/tkitchen
status: closed
type: AFK
covers: [RB-011 (Round workload), slice-1 journal follow-up "Round cost for repos with many branches"]
---

## Parent

`.scratch/tkitchen-v1/PRD.md`. User chose option A on 2026-11-24.

## Why

A Round asks git whether each pair of branches is an ancestor of the other, one `git merge-base --is-ancestor` per pair. On tstack (42 branches) that is 1,764 calls and an 85-89 s Round. `git for-each-ref --contains <branch>` returns every branch that contains it in one call: 42 calls, 2.8 s measured. It gives the same answers and makes no network calls.

## What to build

A `GitRepo` port method `containingBranches(remote, branch)` that returns the remote-tracking branches whose fetched tip contains the fetched tip of `branch`. The Round builds its ancestry table from one call per branch instead of one call per pair. `isAncestor` stays for the reflog checks.

## Acceptance criteria

- [x] The git contract test passes for both the real repo and the sim double: `containingBranches` lists the branch itself plus every branch that contains it, and nothing else.
- [x] The Round never calls `isAncestor` to build the ancestry table; it makes one `containingBranches` call per head.
- [x] Behaviour is unchanged: every existing test passes unchanged, and the DST ground-truth oracle reports 0 violations over 200 seeds and a 2000-seed sweep, with `containingBranches` in the git fault set.
- [x] (amended: 11 s accepted by the user) Live: a tstack Round with `"forge": "none"` takes well under 10 s and gives the same notices as before.

## Evidence (2026-11-24, uncommitted)

- Code: `containingBranches` on the `GitRepo` port (`src/application/ports.ts`), real version via `git for-each-ref --contains` (`src/infrastructure/git/git-repo.ts`), sim version in `tests/sim/doubles/sim-remote.ts`; added to the git fault set and the crash wrapper. `collectAncestorCache` in `src/application/round.ts` now makes one call per head.
- Contract: the new "containingBranches lists the branch and every branch containing it" test passes for the real repo and the sim (25/25 across the contract and walking-skeleton files).
- `npm run verify` exit 0: 114/114 tests, sim 21/21, 200 seeds, 0 violations. 2000-seed sweep: 0 violations. Logs: `.verification-evidence/indicate-v1/issue12/`.
- Live, tstack (42 heads, `"forge": "none"`): Round 85-89 s -> 11.0 s (two runs, exit 0, empty stderr). Notices identical to the issue 11 run: 9/9.
- Criterion 4 is only partly met: 11 s, not under 10 s. A `GIT_TRACE` profile shows 174 git calls (about 67 ms each on Windows): 123 `git reflog`, 42 `for-each-ref`, 6 `rev-parse`, 2 `merge-base`, 1 `ls-remote`. The remainder is base resolution from the reflog (about 3 calls per branch), outside the ancestry scope of this issue.

Accepted by the user on 2026-11-24, including 11 s for criterion 4. The reflog speed-up is parked in the journal.
