# Board page and health route

Spec: `.scratch/kitchen-modules/phase-10-board-verb.md`; the waiter board map is `.scratch/waiter-board/map.md`.

## Sub-features

- `tkitchen board` prints `board at <url>` and serves the built page from `dist/web`
- `GET /v1/health` answers 200 `{"ok":true}` on the same port
- Cleanup stops the board process and its port closes

## How to get to it (user POV)

A person runs `tkitchen board` on the host and opens the printed URL. Later slices put cards and chat behind the same port (D1).

## Driving it with vt.mjs

`bash .verification-skills/verify-tkitchen/scripts/journeys/board.sh`. It builds the page if `dist/web` is missing, starts the board with `board-start` (detached, `--port 0`, output in `board.log` in the run dir), reads the printed URL, checks health, the page and its script asset with curl, then stops the board with `cleanup` and confirms the port is closed. The end state that proves it: every check `PASS`, with `checks.log`, `transcript.log` and `board.log` in the run dir.

## Gotchas

The board needs no kitchen home or git world; the world exists only so the run dir, state file and cleanup work like every other journey. `cleanup` uses `process.kill` (TerminateProcess on Windows), so this journey proves the port frees after a kill. The gentle path (Ctrl-C ends the process with exit 0) is a hand check: start `tkitchen board`, press Ctrl-C, and confirm the shell returns 0. Browser proof that the page renders belongs to the verification that ships each web change, not to this journey.
