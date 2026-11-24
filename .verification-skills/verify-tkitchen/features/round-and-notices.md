# Round and notices with config bases

Spec: `.scratch/tkitchen-v1/issues/` Issue 01.

## Sub-features

- First Round is a baseline: fills `branch_state`, writes no Trigger
- A push to a base marks its children behind; one Base moved Trigger, one Disposition per child
- A quiet rerun adds no rows
- A child that merges its base closes its notice
- Round never writes to the remote
- `--help`; a bad config exits 2 naming the field

## How to get to it (user POV)

Write `bases` in `~/.tkitchen/config.json`, run `tkitchen round`, then `tkitchen notices` (or `--json`).

## Driving it with vt.mjs

`bash .verification-skills/verify-tkitchen/scripts/journeys/round-and-notices.sh`. It builds a fresh world, drives each sub-feature with `vt.mjs` verbs and `kt -- <tkitchen args>`, and prints one `PASS`/`FAIL` line per check. The end state that proves it: every check `PASS`, with `checks.log` and `transcript.log` in the run dir.

## Gotchas

Rows from `notices --json` must match `branch_state`. The human line format is `x <branch> <status> base=<b> behindBy=<n>`.
