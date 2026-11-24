# Round fault tolerance at the CLI

Spec: `.scratch/tkitchen-v1/issues/` Issue 06.

## Sub-features

- Unreachable remote: exit 1, full store snapshot unchanged, `lastError` set
- Remote restored: the next Round records the move and clears the error

## How to get to it (user POV)

Happens on its own when the network or remote is down.

## Driving it with vt.mjs

`bash .verification-skills/verify-tkitchen/scripts/journeys/git-failure.sh`. It builds a fresh world, drives each sub-feature with `vt.mjs` verbs and `kt -- <tkitchen args>`, and prints one `PASS`/`FAIL` line per check. The end state that proves it: every check `PASS`, with `checks.log` and `transcript.log` in the run dir.

## Gotchas

Git timeouts, fetch-after-ls-remote failures, force-push repeats and deletions are proven in the DST sweep (`npm run test:sim`) and `tests/infrastructure/git-timeout.test.ts`, not in this journey.
