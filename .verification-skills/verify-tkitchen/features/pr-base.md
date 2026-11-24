# GitHub PR targets via gh

Spec: `.scratch/tkitchen-v1/issues/` Issue 05.

## Sub-features

- A teammate's branch takes its base from an open PR (`evidence: pr`)
- A PR retarget with no push updates the base
- A gh failure makes the Round incomplete: exit 1, store unchanged, `lastError` set; the next Round catches up
- Fork PRs are ignored
- Config base vs PR target -> `ambiguous/explicit_pr_mismatch`; two PRs from one head -> `ambiguous/multiple_prs`

## How to get to it (user POV)

Open PRs on GitHub; `tkitchen round`; `tkitchen notices`.

## Driving it with vt.mjs

`bash .verification-skills/verify-tkitchen/scripts/journeys/pr-base.sh`. It builds a fresh world, drives each sub-feature with `vt.mjs` verbs and `kt -- <tkitchen args>`, and prints one `PASS`/`FAIL` line per check. The end state that proves it: every check `PASS`, with `checks.log` and `transcript.log` in the run dir.

## Gotchas

The fake gh reads `$R/prs.json`; `FAKE_GH_FAIL=1` makes it exit 1. Real gh is issue 10 (HITL).
