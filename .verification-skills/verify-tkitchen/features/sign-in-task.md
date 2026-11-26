# Windows sign-in task scripts

Spec: `.scratch/tkitchen-v1/issues/` Issue 08.

## Sub-features

- `install-task.ps1 -Export` writes XML with one LogonTrigger, `node.exe ... main.ts serve`, `IgnoreNew`, and registers nothing
- `uninstall-task.ps1` succeeds when no task exists

## How to get to it (user POV)

README "Install on a machine" steps 4-6.

## Driving it with vt.mjs

`bash .verification-skills/verify-tkitchen/scripts/journeys/sign-in-task.sh`. It builds a fresh world, drives each sub-feature with `vt.mjs` verbs and `kt -- <tkitchen args>`, and prints one `PASS`/`FAIL` line per check. The end state that proves it: every check `PASS`, with `checks.log` and `transcript.log` in the run dir.

## Gotchas

Windows only. Never run install without `-Export` here: it would register a real task. Real sign-in is issue 10 (HITL).
