# Automatic base from reflog; needs_base; history

Spec: `.scratch/tkitchen-v1/issues/` Issue 04.

## Sub-features

- Named creation in the round's clone -> `evidence: reflog`
- Commit creation at a base tip -> `evidence: reflog-tip`
- Branch made in another clone with no PR and no config -> `needs_base` with a config hint
- `notices --history` lists Triggers with their Dispositions
- Adding a config base resolves a needs_base branch

## How to get to it (user POV)

Push branches without config; `tkitchen notices` shows evidence; `tkitchen notices --history`.

## Driving it with vt.mjs

`bash .verification-skills/verify-tkitchen/scripts/journeys/automatic-base.sh`. It builds a fresh world, drives each sub-feature with `vt.mjs` verbs and `kt -- <tkitchen args>`, and prints one `PASS`/`FAIL` line per check. The end state that proves it: every check `PASS`, with `checks.log` and `transcript.log` in the run dir.

## Gotchas

Reflog evidence exists only in the clone that the config `path` points at (dev/). Branches pushed from mate/ have none, which is why they come up needs_base.
