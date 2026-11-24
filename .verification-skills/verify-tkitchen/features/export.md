# Export for aiNho (tkitchen.export/1)

Spec: `.scratch/tkitchen-v1/issues/` Issue 09.

## Sub-features

- Empty store -> header + end `events:0`
- Full export: header (`reset:false`), events by `seq`, end with cursor
- `--after <cursor>` streams only newer events
- A cursor whose id no longer matches -> `reset:true` from seq 1
- A bad cursor exits 2 with empty stdout
- No per-machine keys (`outcome`, `status`, `behind_by`, `oid`, `consumer`)

## How to get to it (user POV)

`tkitchen export --json [--after <cursor>]` (aiNho runs this).

## Driving it with vt.mjs

`bash .verification-skills/verify-tkitchen/scripts/journeys/export.sh`. It builds a fresh world, drives each sub-feature with `vt.mjs` verbs and `kt -- <tkitchen args>`, and prints one `PASS`/`FAIL` line per check. The end state that proves it: every check `PASS`, with `checks.log` and `transcript.log` in the run dir.

## Gotchas

The full export is saved as `export-full.ndjson` in the run dir.
