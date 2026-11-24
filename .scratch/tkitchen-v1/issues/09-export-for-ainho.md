---
repo: F:/MyWork/tkitchen
status: ready-for-agent
type: AFK
covers: [US-005, DEC-010, RB-009, DEC-012 (export oracle)]
---

## Parent

`.scratch/tkitchen-v1/PRD.md`

## What to build

`tkitchen export --json [--after <cursor>]`: a read-only NDJSON stream of the store's Triggers for aiNho, resumable by cursor, with reset detection. Triggers only; nothing per-machine leaves the machine. The aiNho importer is out of scope.

## Implementation map

**Precedent**: `F:/MyWork/tstack/src/cli/journal-export.ts` (GROUND-004): header/end lines, opaque `--after <cursor>`, `DatabaseSync` read-only, documented reset limits; consumer pattern aiNho `src/ainho/ingest/tstack_journal.py`; aiNho ADR 0007 keeps imported rows immutable by `(machine_id, event_id)`.

**Contract (normative)**, one JSON object per line:
```json
{"type":"header","schema":"tkitchen.export/1","machine":"DESKTOP-LJB4PL8","reset":false}
{"type":"event","seq":1,"id":"…","source":"git","threads":["git:x:B"],"actor":"git","human":false,"addressed":null,"at":"2026-…","text":null,"channel":null,"url":null,"machine":"DESKTOP-LJB4PL8","meta":{"base":"C","oldHead":"…","newHead":"…"}}
{"type":"end","cursor":"<base64url of {\"s\":1,\"id\":\"…\"}>","events":1}
```
- Events in `seq` order, `seq > cursor.s`.
- Cursor whose `s` has no row, or whose row's `id` ≠ `cursor.id` → `reset: true` and stream from `seq` 1.
- Empty store → header, `end` with `cursor` of `{ s: 0, id: null }`, `events: 0`.
- Malformed cursor → exit 2, message `invalid cursor`, nothing on stdout.
- Never reads or emits `disposition`, `branch_state`, `repo_heads`, `round_status` (RB-009).
- Stated limit (put it in the file's header with `/* oxlint-disable tkitchen/no-comments -- export contract limits */`, tstack precedent): a store replaced by one identical up to the cursor is not detected; harmless because aiNho dedupes by `(machine, id)`.

**Files**: `src/application/export.ts` (pure stream over a store read port), `src/cli/` (`export` subcommand). Open the db read-only.

**Sim**: the sim's human actor runs export between Rounds (keeping the cursor) and sometimes "resets" by replacing the store with a fresh one. Oracle `export-exactly-once`: the union of exported `id`s equals the set of `event.id`s, each id appears once per store generation, and within one generation lines are in strictly increasing `seq`.

**Mechanics left to the implementer**: stdout backpressure handling.

## Acceptance criteria

- [x] Full export
  - Run: `npm test -- tests/cli/export.test.ts`
  - Test: a store with 3 Triggers (built by running `round` on temp repos, `TKITCHEN_HOME` temp).
  - Expected: 5 lines: header (`reset:false`), 3 events with `seq` 1,2,3, end with `events:3`.
  - Fails when: order or line types differ.
- [x] Resume after cursor
  - Run: same file → `after cursor streams only newer`
  - Expected: `--after <cursor from the first export>` after one more Trigger → exactly 1 event line with `seq` 4.
  - Fails when: the cursor is ignored.
- [x] Reset detection
  - Run: same file → `missing seq and changed id are resets`
  - Expected: a cursor for `s:99` → `reset:true`, events from `seq` 1; a cursor `{s:1,id:"other"}` → `reset:true`.
  - Fails when: a mismatched cursor resumes silently.
- [x] Empty store and bad cursor
  - Run: same file → `empty store` / `bad cursor`
  - Expected: empty → header + end `events:0`; `--after not-base64` → exit 2, stdout empty.
  - Fails when: either case crashes or prints partial output.
- [x] Only Triggers leave the machine (RB-009)
  - Run: same file → `no per-machine tables exported`
  - Expected: no line has a key `outcome`, `status`, `behind_by`, `oid` or `consumer`; line `type`s are only `header`, `event`, `end`.
  - Fails when: dispositions or state are included.
- [x] Exactly once across the sweep
  - Run: `npm run test:sim`
  - Expected: `export-exactly-once` 0 violations.
  - Fails when: any interleaving of Rounds and exports loses or repeats an id.

## Blocked by

- Local: `03-dst-harness-and-ground-truth-oracle.md` — provides the sim world and runner where the export oracle runs. Proof: the sweep criterion above.
- (Transitively `01-walking-skeleton-round-and-notices.md`: the `event` table and `seq`.)

## Implementation (eng-09, 2026-11-24)

Built `src/application/export.ts` (pure stream over a store read port, stated reset limit in its header), `src/infrastructure/sqlite/export-store.ts` (DatabaseSync read-only, only SELECTs from `event`), the `export --json [--after]` CLI subcommand with drain-aware stdout writes (bad cursor: exit 2, `invalid cursor` on stderr, stdout empty), `tests/cli/export.test.ts` (6 tests), and the sim Exporter actor + `export-exactly-once` oracle (cursor kept between Rounds, store sometimes replaced with a fresh one; sweep asserts resets actually occurred). Full gate: `npm run verify` exit 0 (107/107 tests, sim 21/21, 200 round seeds 0 violations). Evidence: F:/MyWork/tkitchen/.verification-evidence/eng-09/report.md. Ready for qa-09 review.
