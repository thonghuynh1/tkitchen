# Waiter board (board and card chat)

Spec: `.scratch/waiter-board/map.md`, `.scratch/waiter-board/wayfinder/01-board-and-card-chat.md`, `.scratch/waiter-board/ledger.md` (D1–D5, D7–D18).

## Sub-features

- Local-hosted board (`tkitchen board [--port <n>] [--host <addr>] [--public-url <url>]`) backed by `~/.tkitchen/board.db` (leaving `kitchen.db` untouched)
- GitHub OAuth sign-in (`UserId = github:<numeric id>`) with single host owner (`ownerGithubId`) and invite-only access for non-owners
- Kanban cards across `Todo`, `Doing`, and `Done` columns, owner soft-delete (`archived_at`), and per-card multi-use invite links with "Close sharing" and individual member removal
- One-level card threads, `@waiter` mention detection (`mentionsWaiter` placeholder, no Trigger yet) with `@` composer picker, and live board + chat updates over a single per-user SSE stream (`GET /v1/stream`) with `?after=<seq>` catch-up on reconnect

## How to get to it (user POV)

The host owner runs `tkitchen board` (with `--public-url https://board.<domain>` behind a Cloudflare Named Tunnel on a personal machine, or localhost-only on a work laptop). Friends sign in with GitHub via an invite link, see only the cards they belong to, chat live, and lose access immediately when removed or when the owner closes sharing.

## Drive scenarios

### 1. GitHub sign-in, host owner, and `--public-url` (`planned`)

- Start `tkitchen board --port 0 --public-url https://board.example.test` with an injected test OAuth provider and `ownerGithubId`.
- Confirm OAuth callback URL and invite links use `https://board.example.test`, `Secure` cookie is set, owner sees `GET /v1/me` as owner, and signed-in stranger receives `403` on `POST /v1/cards`.

### 2. Cards, multi-use invites, individual kick, Close sharing, and soft-delete (`planned`)

- Owner creates Card 1 and generates invite token `T1`; Alice and Charlie redeem `T1` and see Card 1 on `GET /v1/cards`.
- Owner removes Alice: Alice receives `403` on Card 1, `T1` returns `410` on replay, Charlie remains a member.
- Owner clicks Close sharing: Charlie is removed and receives `403`; owner generates fresh `T2` and Alice/Charlie can join again.
- Owner soft-deletes Card 1 (`DELETE /v1/cards/:id`): `archived_at` is set in `board.db`, card disappears from all board/chat queries (`404`), and `T2` returns `410`.

### 3. Live SSE chat, 1-level threads, instant stream revocation, and `@waiter` placeholder (`planned`)

- Owner and Alice open `GET /v1/stream` and chat on Card 1; replying to a reply attaches to the parent message.
- Posting `"hey @Waiter, check this"` sets `mentionsWaiter: true`; `"alice@waiter.io \`@waiter\`"`sets`mentionsWaiter: false`; `kitchen.db` receives zero Triggers.
- Disconnect Alice's SSE stream while Owner posts a message; reconnect and call `GET /v1/cards/:id/messages?after=<lastSeq>` to verify zero missed messages.
- Remove Alice while her SSE stream is open: server writes `card_removed` and closes her SSE stream immediately; subsequent messages never reach Alice.

### 4. Deterministic simulation and model conformance (`planned`)

- Run `DST_SEEDS=200 npm run test:sim` (board DST suite) and verify `INV-001`..`INV-004` and `PRG-001` hold at every step across fault schedules.
- Export `DST_TRACE_OUT=.scratch/waiter-board/model/dst-trace.jsonl` and confirm `node C:/Hackathon/hackathon-grill-me/dist/formal/cli.js .scratch/waiter-board/model/model.mjs --trace .scratch/waiter-board/model/dst-trace.jsonl` exits 0.

### 5. Board web UI end-to-end (`planned`)

- Build `dist/web` (`npm run build:web`) and drive two browser sessions (owner + invitee) against a local board with injected test OAuth: sign in, invite by link, move card across columns, chat live with `@` mention picker, remove invitee and observe card vanish + chat close immediately.

### 6. Live GitHub OAuth + Cloudflare Named Tunnel smoke (`planned`, HITL)

- On the home PC behind `https://board.<domain>`, two real GitHub users sign in, join via invite link, chat live, and verify instant removal / Close sharing.

## Gotchas

- `board.db` lives beside `kitchen.db` under `TKITCHEN_HOME`; verify `kitchen.db` is never modified by board operations.
- Automated drives inject a fake `GitHubOAuthPort` so tests never hit live GitHub; real GitHub OAuth + Cloudflare Tunnel is covered by the HITL smoke.
