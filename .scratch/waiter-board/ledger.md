# Ledger: waiter-board

Requirement (user, 2026-11-25): a shared place where people chat and ping a bot. A kanban board; each card is a Slack-style thread. Clicking a card opens its chat. A card has one or more members; the owner shares an invite link, invitees see the card on their own board, and the owner can remove members. Plain chat triggers nothing; only a message with `@waiter` sends one Trigger to an orchestrator bot (aiLau or a durable Pi, undecided), which reads the thread's context and acts. Not part of the aiNho viewer or the tstack companion UI.

Status: charted into map.md (2026-11-25, user chose a map).

Loaded by pick-flow -> grill-with-docs, 2026-11-25, from my-home session (durable Pi plan, `my-home/.scratch/durable-pi/plan.md`). Answers tkitchen K1 (the workspace). Lives here until the new repo exists, then moves.

Verification profile: model+dst. Reason: membership changes (invite, remove) must cut access at once, an `@waiter` must make exactly one Trigger across reconnects and retries, and the bot may be offline when it is pinged.

## Decisions

- D1 accepted (user, 2026-11-25; supersedes the Cloudflare-hosted D1): the board is local-hosted and portable: it runs on whichever machine hosts it (work laptop or home PC), the waiter runs on that same host, and an `@waiter` Trigger goes straight into that host's tkitchen. While it runs, the host exposes it at a URL; reachability is "who knows the URL", and GitHub sign-in (D7) still decides who is a member. Supersedes: Worker + Durable Object per card; K-cost no longer applies. Consequence: ticket 02 needs no machine-to-machine connector.
  Flow: host runs board + waiter → exposes a URL → friend opens URL → GitHub sign-in → card → `@waiter` → host's kitchen → waiter replies.
- D8 accepted (user, 2026-11-25; was K-hostdata): each host has its own board and its own store; a card lives on the machine it was made on. Nothing syncs between hosts. Later option (not v1): one board that moves with the host (upload/download the store over R2 like aiNho sync, plus a host lock so only one machine hosts at a time).
- D9 accepted (user, 2026-11-25): borrow mattpocock/cookout's patterns, not its code. Reasons: no license anywhere (no LICENSE file, GitHub `license: null`, npm `@ai-hero/cookout` has no license field), so its code is all rights reserved; it changes ~200 tickets a day (v0.8.0, created 2026-11-22); its server is Effect v4 throughout; and it has none of GitHub sign-in, per-card membership/invites, exactly-once mention delivery, or a kanban. We rewrite on our own stack: SSE live updates where ending a credential closes its open streams (cookout ADR 0063); webhook delivery with a `callId`, persisted retries and resume on restart; one-level threads and `@name` parsing rules; the module layout (public `index.ts`, internals in `lib/`, private `tests/`); module seams enforced by dependency-cruiser; the lint ratchet (per-file per-rule baseline, growth fails) and a guard that refuses lint loosening; small generic lint rules (branded ids, no unsafe `as`, max file tokens, glossary terms from `CONTEXT.md`).
- D10 accepted (user, 2026-11-25): our own UI, built with shadcn/ui (Radix + Tailwind). cookout's UI lint (one component per file, no ternaries; its ADR 0080) is not borrowed, since it fights shadcn's generated components.
- K-expose open, waits-on: user. How the host gets its URL (Cloudflare quick tunnel with a random URL, a named tunnel with a fixed hostname, other), and whether the work laptop may expose one (company policy).
- D2 accepted (user, 2026-11-25): v1 users are people on personal projects, not work colleagues. Work data on personal infrastructure is out until cleared at work.
- D3 accepted (user, 2026-11-25): any member may write `@waiter`; only the card owner's bot acts, on the owner's machine.
- D4 accepted (user, 2026-11-25): v1 waiter reads the thread and replies only (observe mode). Real actions (tstack dispatch, PRs) come later.
- D5 accepted (user, 2026-11-25): fixed columns Todo / Doing / Done; only people move cards in v1.
- D6 superseded by D11 (2026-11-25). Was: a new repo, separate from tkitchen.
- D11 accepted (user, 2026-11-25; supersedes D6): the board is built inside tkitchen, and tkitchen is restructured into vertical modules on cookout's patterns first. Plan: `.scratch/kitchen-modules/overview.md`. K-name closed (no new repo).

## Open

- D7 accepted (user, 2026-11-25; was K-id): sign-in with GitHub, built in the Worker (GitHub OAuth app; client id/secret as Worker secrets; a session cookie). Chosen over Cloudflare Access (no seat limit, no Zero Trust setup) and over link-only (no proven identity). Default recorded: a person is keyed by GitHub's numeric user id, not the login (logins can be renamed); the login is shown. Trigger `actor` = `github:<id>`. Left to the implementer: where sessions live (signed cookie or a store), cookie lifetime.
  Flow: open invite link → "Sign in with GitHub" → OAuth callback → session cookie → card checks membership → join.
- K-invite open, waits-on: user. Invite link: one use or many, expiry, and that removing a member cuts their access at once (open sockets too).
- K-bot open, waits-on: repo. What connects the owner's machine to the board: a new small connector, a tkitchen producer, or aiLau's cloud extension.
- K-trigger open, waits-on: repo. Where the `@waiter` Trigger is first written (the card's Durable Object or the owner's local kitchen) and how it reaches the bot exactly once.
- K-context open, waits-on: user. What thread context the bot gets (whole thread or since the last `@waiter`, a cap, untrusted text as id + summary).
- K-reply open, waits-on: user. How the bot answers (as a `waiter` member in the thread; one final message or streamed).
- K-offline open, waits-on: user. What happens when the owner's bot is offline at ping time (queue and show "waiting", or refuse).
- K-machine open, waits-on: user. Which of the owner's machines takes the ping when both are online (tkitchen K6).
- K-boardstore open, waits-on: repo. Where a user's board (list of cards) lives: a Durable Object per user, or D1.
- K-retention open, waits-on: user. How long threads are kept and who can delete a card.
- K-cost superseded by D1 (2026-11-25). Was accepted (repo, 2026-11-25): Durable Objects run on the Workers Free plan, SQLite-backed only; over a daily free limit, further operations of that type fail until 00:00 UTC (developers.cloudflare.com/durable-objects/platform/pricing). Cloudflare Access consumes one seat per signed-in person; once seats run out, new people are blocked (cloudflare-one seat-management). Free seat count not confirmed in docs read.
- K-name closed by D11 (2026-11-25): no new repo.

deliveries: 3 (board + multi-user card chat; `@waiter` Trigger + owner's bot connection; bot reads and replies)
modules: 2 (new repo; tkitchen glossary/Thread kind, maybe a station)
contract: y (new Thread kind `board:<card>`, Trigger source `board`, wire protocol between board and bot)
Size check: open=12 closed=6 waits=[] deliveries=3 modules=2 contract=y trend==
Size check: open=11 closed=7 waits=[] deliveries=3 modules=2 contract=y trend=-
Size check: open=10 closed=8 waits=[] deliveries=3 modules=2 contract=y trend=-
Size check: open=11 closed=7 waits=[] deliveries=3 modules=2 contract=y trend=+ (D1 reopened)
Size check: open=12 closed=8 waits=[] deliveries=3 modules=2 contract=y trend=+ (D1 re-decided: local portable host)
Size check: open=11 closed=9 waits=[] deliveries=3 modules=2 contract=y trend=-
Size check: open=11 closed=11 waits=[] deliveries=3 modules=2 contract=y trend=- (D9 borrow cookout patterns, D10 own shadcn UI)
Size check: open=10 closed=13 waits=[] deliveries=3 modules=1 contract=y trend=- (D11 build in tkitchen, K-name closed)

## Ticket 01: Board and card chat (started 2026-11-26)

Decisions:
- D12 accepted (user, 2026-11-26; closes K-expose): `tkitchen board` stays tunnel-agnostic and listens locally (`127.0.0.1:<port>`), taking `--public-url <url>` (or config/env `publicUrl`, defaulting to the local bind URL). OAuth callback URL, invite links, and `Secure` cookie flag derive from `publicUrl`. Home PC exposes a dedicated subdomain (`board.<domain>`, no Cloudflare Access in front so friends can use GitHub OAuth) via a Cloudflare Named Tunnel (free tier: 1 of 1,000 tunnels); work laptop stays localhost-only (`my-home/.scratch/durable-pi/plan.md` L35-36: nothing inbound, no `cloudflared.exe`).
  Flow: `Alice --HTTPS--> Cloudflare Named Tunnel (board.<domain>) --HTTP--> tkitchen board (127.0.0.1:3000)`
  Left to implementer: exact env/config key name for `publicUrl` and OAuth client credentials.
- D13 accepted (user, 2026-11-26; closes K-auth-local): Single host owner (pinned by config/env `ownerGithubId`, keyed as `github:<numeric id>` per D7). Only the host owner may create cards, create/revoke invites, and remove members. Invited GitHub users see only cards they are currently members of (and may chat + move those cards). Signed-in strangers with no memberships see an empty board and get `403` on card creation or non-member cards.
  Flow: `Owner -> create/invite/remove/chat | Alice (member of Card 1) -> sees Card 1, chat & move | Bob (stranger) -> empty board, 403 on write`
  Left to implementer: signed cookie vs session table and cookie lifetime (per D7).
- D14 accepted (user, 2026-11-26; closes K-invite): Each card has at most one active multi-use invite link (open to any GitHub user who has it, no expiry needed because owner controls it explicitly). Owner has **"Close sharing"** which revokes the active invite link, kicks **every** non-owner member from the card, and immediately closes all their open SSE streams (D9 pattern); card disappears from their boards. Owner can also remove an individual member (removes them, closes their SSE stream, and revokes the active invite link so they cannot immediately rejoin with the old link while other members stay). Clicking **"Create invite link"** again generates a brand-new token (old tokens stay permanently dead) so people with the new link can join again.
  Flow: `Create invite link (token v1, multi-use) -> Alice & Charlie join -> Close sharing -> revoke v1 + kick Alice & Charlie + close streams -> Create invite link (token v2) -> join again`
  Left to implementer: token length/encoding (cryptographically random via `Random`/`Ids` seam).
- D15 accepted (user, 2026-11-26; closes K-boardstore): Board data lives in a separate SQLite file `~/.tkitchen/board.db` beside `~/.tkitchen/kitchen.db`. `modules/triggers` and `kitchen.db` (`user_version = 1`) stay completely untouched; new board modules own `board.db` and expose `web.ts` contracts to `src/`.
  Flow: `~/.tkitchen/kitchen.db (triggers) | ~/.tkitchen/board.db (identities, cards, members, invites, messages)`
  Left to implementer: exact SQLite table/column DDL and PRAGMA settings (WAL, foreign keys).
- D16 accepted (user, 2026-11-26; closes K-chat-live): Single per-user SSE stream (`GET /v1/stream`) for both live board updates (`card_created`, `card_moved`, `card_deleted`, `card_removed`) and live card chat (`message_created`), paired with plain HTTP `POST` for sending messages and `GET /v1/cards` + `GET /v1/cards/:id/messages?after=<lastSeq>` catch-up on reconnect. One-level threads (D9: replying to a reply attaches to the parent message); Todo/Doing/Done column moves by any card member or owner (D5). On removal or Close sharing, server immediately writes `card_removed` and ends the removed user's open SSE handle(s) (D9).
  Flow: `POST /v1/cards/:id/messages -> SQLite (monotonic seq) -> fan-out to member SSE handles | reconnect -> GET ?after=lastSeq | remove -> delete membership + close SSE handle`
  Left to implementer: SSE heartbeat interval, exact JSON field names on wire events.
- D17 accepted (user, 2026-11-26; closes K-retention): Messages are kept forever in `board.db` (no auto-expiry). Only the host owner may soft-delete (archive) a card (`archived_at = now`); invited members get `403`. Soft-deleting revokes any active invite link, removes non-owner members, closes their open SSE handles (`card_removed`), and hides the card from all board/chat/invite queries (`404`/`410`). Rows remain in `board.db`; no archive viewer or restore UI in slice 1.
  Flow: `Owner clicks Delete -> UPDATE cards SET archived_at = now + revoke invite + remove non-owner members + close SSE handles -> card vanishes live, rows kept in board.db`
  Left to implementer: exact confirmation dialog copy in UI.
- D18 accepted (user, 2026-11-26; closes K-waiter-placeholder; placeholder for 02-waiter-reaches-the-owner.md): Every saved message carries `{ id: MessageId, cardId: CardId, seq: number, parentId: MessageId | null, authorId: UserId, text: string, mentionsWaiter: boolean, createdAt: string }`. `parseMentionsWaiter(text)` strips fenced/inline code spans and matches `/(^|[^\w])@waiter(?=$|[^\w])/i`. Slice 1 records the flag and does nothing else with it (no Trigger written). The chat composer shows a `@` mention picker (`@waiter`) so users insert it without typos.
  Flow: `Composer "@" -> pick @waiter -> POST /v1/cards/:id/messages -> parseMentionsWaiter(text) -> saved with mentionsWaiter=true (no-op in slice 1)`
  Left to implementer: exact mention popover keyboard shortcuts and styling (shadcn).

Invariants:
- INV-001 (from D13): Only the host owner may create cards; non-members may never read, write, or hold an open live stream for a card. — Harm: strangers on the public URL could write to local SQLite or read private card threads. — Model: `invariants["INV-001"]`
- INV-002 (from D14): A removed member can never rejoin using an invite link created before or at their removal. — Harm: kicked user clicks their old invite link and immediately re-enters the card. — Model: `invariants["INV-002"]`
- INV-003 (from D16): A non-member never receives messages posted after removal (neither via SSE nor via catch-up). — Harm: removed user leaks private messages posted after they were kicked. — Model: `invariants["INV-003"]`
- INV-004 (from D17): A soft-deleted (archived) card has no active invite, no non-owner members, and no open live streams. — Harm: archived card remains reachable via old invite link or keeps streaming to former members. — Model: `invariants["INV-004"]`
- PRG-001 (from D16): An active member who missed messages during a disconnect can always catch up (or be removed/archived). — Harm: messages posted during a Wi-Fi drop are permanently lost for an active member. — Model: `progress["PRG-001"]`

Open for this ticket (refreshed after D1/D8/D11 superseded Worker/DO/D1):
(none — ready for handoff)

## Ticket 01 Edges & Proof

Edges (confirmed by user, 2026-11-26):
- Callers and consumers: only the built web app (`src/` → `dist/web`) calling `modules/board-http` over HTTP/SSE. `tkitchen serve`, `round`, `notices`, and `export` (aiNho) stay untouched in Slice 1. Ticket 02 will later consume `MessageId` + `mentionsWaiter`.
- Workload: personal projects (D2) — 1 host owner + ~1–5 friends, tens of cards, hundreds–thousands of messages in `board.db`, <10 concurrent SSE tabs.
- Setup and rollout: home PC runs `tkitchen board --public-url https://board.<domain>` behind a Cloudflare Named Tunnel (no Access policy in front) + GitHub OAuth App (`clientId`, `clientSecret`, `ownerGithubId` via env/config); work laptop & automated tests run localhost-only (`127.0.0.1`) with an injected auth/OAuth seam (no live GitHub needed in tests). No existing `board.db` to migrate.

Deterministic seams (for `model+dst`):
- `Clock`, `Random`, `Ids`, `Scheduler` from `modules/platform/index.ts` (already exists; enforced by `verify:structure`).
- `BoardStore` port (SQLite adapter in `board.db` + in-memory DST double).
- `GitHubOAuthPort` (live HTTPS adapter + fake test/DST adapter).
- `LiveHub` port (in-process SSE stream registry wrapping `ServerResponse` handles + DST spy/fault double supporting disconnect, drop, reorder, and immediate close on revocation).

DST fault matrix (seeded simulation over pure board modules):
- Faults: SSE disconnect/drop mid-chat, duplicate invite redeem, concurrent remove-member vs post-message, concurrent Close sharing vs invite redeem, archive-card while streams open, reconnect catch-up after missed messages, server restart (re-opening `board.db`).
- Oracles: `INV-001` (non-members never hold streams or create cards), `INV-002` (removed member never rejoins with old invite), `INV-003` (no post-removal message leaks via SSE or catch-up), `INV-004` (archived card has no active invite/members/streams), `PRG-001` (active member catches up missed messages on reconnect).

Ticket 01 scope: deliveries=1 modules=5 contract=y (new board modules + HTTP/SSE API + web.ts contracts)
Size check: open=0 closed=7 waits=[] deliveries=1 modules=5 contract=y trend=- (D18 K-waiter-placeholder accepted)
Model check (covers D13, D14, D16, D17): states=370 edges=1610 invariants=4 progress=1 violations=0 stuck=0 deadlocks=0 truncated=n (13.11ms)
Final model check: PASS (370 states, 4 INV, 1 PRG, mutants 5/5, ledger ids all modeled)

## Slice 1 Cutting Gate (2026-11-26)

- **Decision completeness**: PASS
  - D7, D12, D13, D14, D15, D16, D17, D18: all `contract settled` (no open contracts; only local mechanics left to implementer).
  - Final model check: `PASS (370 states, 4 INV, 1 PRG, mutants 5/5, ledger ids all modeled)` run after last ledger decision edit.
  - Deterministic seams settled: `Clock`, `Random`, `Ids`, `Scheduler` (`modules/platform`), `IdentityStore`, `CardStore`, `ChatStore`, `GitHubOAuthPort`, `LiveHub`.
- **Independence**: PASS (`ALLOW`)
  - Candidate scope: `modules/identities/`, `modules/cards/`, `modules/chat/`, `modules/live/`, `modules/board-http/`, `modules/cli/`, `index.ts`, `sim/board.sim.ts`, `src/`, `.verification-skills/verify-tkitchen/features/waiter-board.md`.
  - Pending work checked: `.scratch/waiter-board/issues/` had no prior issues; `.scratch/tkitchen-v1/issues/` are all closed and indicated (`journal.md` present); `kitchen-modules` phases 1–10 and ADRs 0004–0005 are already landed at Base `3bc6f97e7b43348967bc89b9525cceb8f9d935d4`. Zero overlap.
- **Verdict**: `ALLOW` → verification feature `.verification-skills/verify-tkitchen/features/waiter-board.md` registered; Slice 1 cut into issues `01`–`06`.

### Slice 1 Proof Requirements
- **D7 / D12 / D13 / D15** (Slice 1, planned): `tkitchen board --public-url` + GitHub OAuth callback + owner check + separate `board.db` → proven by `modules/cli/tests/parse-board.test.ts` & `modules/board-http/tests/auth.test.ts` + HITL smoke (`06-hitl-live-github-and-tunnel-smoke.md`).
- **D5 / D13 / D14 / D17** (Slice 1, planned): cards, columns, multi-use invites, individual kick revoking invite, Close sharing, soft-delete (`archived_at`) → proven by `modules/board-http/tests/cards.test.ts`.
- **D9 / D16 / D18** (Slice 1, planned): 1-level threads, `@waiter` parser placeholder, single per-user SSE stream + `?after=<seq>` catch-up + immediate SSE close on removal/Close sharing/archive → proven by `modules/chat/tests/chat.test.ts` & `modules/board-http/tests/live-chat.test.ts`.
- **Formal & DST (`model+dst`)** (Slice 1, planned): `INV-001`..`INV-004` + `PRG-001` verified in `.scratch/waiter-board/model/model.mjs` (0 violations, 0 deadlocks, 5/5 mutants killed) and enforced step-by-step by `DST_SEEDS=200 npm run test:sim` (`sim/board.sim.ts`) + `cli.js --trace` conformance check.
- **D10 / D18 UI** (Slice 1, planned): `src/` web app using `modules/*/web.ts` only → proven by `npm run verify`, `modules/board-http/tests/web-e2e.test.ts`, `board.sh`, and HITL smoke on home PC.
