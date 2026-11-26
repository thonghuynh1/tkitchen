# Phase 10: Board verb and health route

[Overview](overview.md)

## Goal

`tkitchen board` serves the built page and `/v1/health` on one port on the host (D1). This is the skeleton waiter-board tickets 01 to 03 build on.

## Changes

- `modules/board-http/` (new module): `index.ts` exports `startBoardServer(options): Promise<BoardServer>`. `lib/adapters/server.ts` uses `node:http` to serve `dist/web` and answer `GET /v1/health` with `{ ok: true }`. No framework yet; ticket 01 may choose one and record an ADR.
- `cli/tkitchen.ts`: a `board` verb with `--port` (default 3000) and `--host` (default `127.0.0.1`, since exposure is K-expose and still open). It prints the URL and stops cleanly on Ctrl-C.
- `modules/board-http/tests/health.test.ts`: start on port 0, then `GET /v1/health` returns 200 `{ ok: true }` and `GET /` returns the page's HTML.
- `.verification-skills/verify-tkitchen`: one new journey that starts `tkitchen board`, checks health and stops it (`maintain-verification-skill`).
- `.scratch/waiter-board/map.md`: tickets 01 to 03 now build modules on this skeleton (`identities`, `cards`, `chat`, `live`, `waiter`).

## Data structures

- `BoardServer = { url: string; close(): Promise<void> }`.
- `BoardServerOptions = { port: number; host: string; webRoot: string }`.

## Verification

Static: `npm run verify` exit 0.

Runtime: `tkitchen board --port 0` prints a URL; `control-ui` opens it and finds the three columns; `curl <url>/v1/health` returns `{"ok":true}`. Ctrl-C ends the process with exit 0 and the port is free afterwards.
