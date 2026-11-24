# Serve loop and single-instance lock

Spec: `.scratch/tkitchen-v1/issues/` Issue 07.

## Sub-features

- `serve` writes `kitchen.lock` with its pid
- A second `serve` exits 1 with `already running (pid N)`
- `round` refuses while serve runs; `round --force` exits 2
- The loop notices a push without user action; `lastCompleteAt` advances
- A lock left by a killed serve is taken over

## How to get to it (user POV)

The sign-in task starts `tkitchen serve`; users run `tkitchen notices`.

## Driving it with vt.mjs

`bash .verification-skills/verify-tkitchen/scripts/journeys/serve-and-lock.sh`. It builds a fresh world, drives each sub-feature with `vt.mjs` verbs and `kt -- <tkitchen args>`, and prints one `PASS`/`FAIL` line per check. The end state that proves it: every check `PASS`, with `checks.log` and `transcript.log` in the run dir.

## Gotchas

`serve-start $R 0.05` sets `roundMinutes` to 3 s so the loop is observable. `cleanup` uses `process.kill` (TerminateProcess on Windows), which leaves a dead-pid lock behind; that is how the takeover case is built.
