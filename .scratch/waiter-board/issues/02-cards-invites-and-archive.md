---
repo: C:/Hackathon/tkitchen
slice: 1
parent_tickets: [01-board-and-card-chat]
covers_decisions: [D5, D13, D14, D15, D17]
status: open
labels: [ready-for-agent]
---

## Parent

- Wayfinder map: `.scratch/waiter-board/map.md`
- Slice: 1
- Originating ticket & slice promise: `.scratch/waiter-board/wayfinder/01-board-and-card-chat.md#slice-1--board-and-card-chat`

## What to build

Build `modules/cards/` (cards, `Todo / Doing / Done` columns, per-card membership, multi-use invite links, individual member removal, "Close sharing", and owner soft-delete/archive) persisted in `~/.tkitchen/board.db`, and expose its HTTP routes in `modules/board-http/`. Covers **D5**, **D13**, **D14**, **D15**, **D17**, **INV-001**, **INV-002**, and **INV-004** (persistence/HTTP half; live SSE revocation wires in Issue 03).

## Implementation map

### Accepted decisions & contracts (carry verbatim)

- **D5 (Columns)**: Fixed columns `"todo" | "doing" | "done"`. Any current member of a card (owner or invitee) may move it between columns.
- **D13 (Owner vs member vs stranger)**:
  - Only the host owner (`user.isOwner === true`) may create cards, create/rotate invite links, remove members, click Close sharing, or soft-delete (archive) a card. Non-owners get `403` with zero state change.
  - `GET /v1/cards` returns only active (`archived_at IS NULL`) cards where the caller is the owner or a current member. Signed-in strangers see `[]`.
- **D14 (Multi-use invite link, individual removal, Close sharing)**:
  - Each active card has at most one active multi-use invite link (`<publicUrl>/invite/<token>`, no expiry). Calling `POST /v1/cards/:id/invite` returns the current active invite or creates a new token if none is active.
  - `POST /v1/invites/:token/redeem` (any signed-in user): adds caller to `card_members` iff the token is active and its card is active (`archived_at IS NULL`); idempotent if already a member. Returns `410` if token is revoked/unknown or card is archived (no membership added).
  - `DELETE /v1/cards/:id/members/:userId` (owner only; cannot remove owner → `400`): atomically deletes that user's membership AND revokes the card's active invite link (so the removed user cannot replay the old link; other members stay).
  - `POST /v1/cards/:id/close-sharing` (owner only): atomically revokes the active invite link AND deletes ALL non-owner memberships on that card.
  - Creating a new invite link after removal or Close sharing generates a **brand-new** token via `Ids`/`Random`; old tokens remain permanently dead (`410`).
- **D17 (Soft-delete / archive)**:
  - `DELETE /v1/cards/:id` (owner only; non-owner → `403`): atomically sets `archived_at = clock.now().toISOString()`, revokes any active invite link, and removes all non-owner memberships. Rows stay in `board.db`.
  - Archived cards are excluded from `GET /v1/cards`, return `404` on `PATCH /v1/cards/:id/column`, `POST /v1/cards/:id/invite`, `DELETE /v1/cards/:id/members/:userId`, `POST /v1/cards/:id/close-sharing`, and `410` on any invite redeem.
- **Multi-entity transition hooks**: Emit a clean pure result describing affected `removedUserIds: UserId[]` and `card` state so Issue 03 (`modules/live`) can immediately push `card_removed` and close SSE handles for those users without duplicating business rules.
- **Accepted input surface**:
  - `GET /v1/cards` → `200 { ok: true, cards: CardSummary[] }`
  - `POST /v1/cards` `{ title: string }` (non-empty trimmed) → `201 { ok: true, card }` (`403` non-owner, `400` empty title)
  - `PATCH /v1/cards/:id/column` `{ column: "todo" | "doing" | "done" }` → `200 { ok: true, card }` (`403` non-member, `404` missing/archived, `400` invalid column)
  - `POST /v1/cards/:id/invite` → `200 { ok: true, token, url }` (`403` non-owner, `404` missing/archived)
  - `POST /v1/invites/:token/redeem` → `200 { ok: true, card }` (`410` invalid/revoked/archived)
  - `DELETE /v1/cards/:id/members/:userId` → `200 { ok: true, removedUserId }` (`403` non-owner, `400` removing owner, `404` missing/archived)
  - `POST /v1/cards/:id/close-sharing` → `200 { ok: true, removedUserIds }` (`403` non-owner, `404` missing/archived)
  - `DELETE /v1/cards/:id` → `200 { ok: true, archivedAt, removedUserIds }` (`403` non-owner, `404` missing/archived)

### Blocking-edge wiring (from Issue 01)

- **Producer**: `01-identities-and-oauth.md` exports `UserId`, `IdentityUser`, `IdentityStore`, session auth middleware/helper in `modules/identities/` and `modules/board-http/`, and `publicUrl` on `BoardServerOptions`.
- **Consumer**: `modules/cards/` imports `UserId` from `modules/identities/index.ts`; `modules/board-http/` authenticates every `/v1/cards*` and `/v1/invites/*` request using Issue 01's session lookup (`401` if unauthenticated) and builds invite `url` from `publicUrl`.
- **Wiring owner**: `modules/cli/lib/adapters/run.ts` constructs `SqliteCardStore(join(kitchenHome(), "board.db"))` and passes it into `startBoardServer`.

### Callers of changed symbols

- `modules/board-http/lib/contract.ts`, `modules/board-http/lib/adapters/server.ts`: **required edit** — add `cards` service/store option and route `/v1/cards*` + `/v1/invites/*`.
- `modules/cli/lib/adapters/run.ts`: **required edit** — wire `SqliteCardStore` into `runBoard`.
- `index.ts`: **required edit** — export `modules/cards` entries.
- `modules/board-http/tests/health.test.ts`, `modules/board-http/tests/auth.test.ts`: **unchanged — reason**: existing health and auth routes remain intact.

### Mechanics left to implementer

- Exact SQLite DDL for `cards`, `card_members`, `card_invites` in `board.db`, invite token encoding (via `Ids`/`Random`), and internal helper organization inside `modules/cards/lib/`.

## Acceptance criteria

- [ ] Owner creates a card, invites Alice and Charlie via one multi-use link, both see it on `GET /v1/cards` and can move its column; stranger Bob gets `403` on create and sees `[]`
  - Run: `npx vitest run modules/board-http/tests/cards.test.ts`
  - Test: `planned` → `modules/board-http/tests/cards.test.ts` → `owner creates card, multi-use invite admits Alice and Charlie, stranger Bob is denied`
  - Expected: Owner `POST /v1/cards` returns `201`; Bob `POST /v1/cards` returns `403` with zero cards added; Alice and Charlie redeem `T1` → `200`, see Card 1 on `GET /v1/cards`, and Alice moves it to `"doing"` (`200`).
  - Fails when: non-owner can create a card, invite is single-use, or stranger sees cards.

- [ ] Removing Alice deletes only Alice's membership and revokes `T1` (`INV-002`); Charlie remains a member, Alice cannot replay `T1` (`410`), and a new `T2` lets Alice rejoin
  - Run: `npx vitest run modules/board-http/tests/cards.test.ts`
  - Test: `planned` → `modules/board-http/tests/cards.test.ts` → `removing Alice revokes active invite while keeping Charlie, and fresh invite allows rejoin`
  - Expected: `DELETE /v1/cards/:id/members/github:2` returns `200`; Alice gets `403` on card move and `410` on redeeming `T1`; Charlie still sees Card 1; owner creates `T2 !== T1`, Alice redeems `T2` → `200`.
  - Fails when: `T1` still works after Alice's removal, Charlie is accidentally kicked, or `T2` equals `T1`.

- [ ] Close sharing kicks every non-owner member and revokes the active invite atomically, and soft-delete (`DELETE /v1/cards/:id`) sets `archived_at` in `board.db` while hiding the card from all endpoints (`INV-004`)
  - Run: `npx vitest run modules/board-http/tests/cards.test.ts`
  - Test: `planned` → `modules/board-http/tests/cards.test.ts` → `close sharing kicks all non-owners and soft-delete archives card while keeping SQLite row`
  - Expected: Close sharing returns `removedUserIds` containing both Alice and Charlie and revokes `T2` (`410`); non-owner `DELETE /v1/cards/:id` returns `403` with `archived_at` still `NULL`; owner `DELETE /v1/cards/:id` sets `archived_at` (row still exists in `board.db`), `GET /v1/cards` excludes it, and `PATCH`/`POST` return `404` (`410` on invite).
  - Fails when: card row is hard-deleted instead of `archived_at`, non-owner can delete, or archived card stays reachable.

- [ ] Full repo verification passes
  - Run: `npm run verify`
  - Test: repo gate
  - Expected: exit 0.
  - Fails when: any seam, lint, structure, type, or test check fails.

## Blocked by

- Local: `01-identities-and-oauth.md`

## Comments

- **QA-02: verdict fail** at `6a725b146e46571c6290a32209fa67e28c6379d8`. The full repo gate and all nine focused tests passed, but the real CLI showed a D5/INV-001 violation: after a host-owner change, the new host owner could move a card they did not belong to. The request returned 200 rather than 403, returned the card summary, and changed the stored column.
- Review evidence: `F:/MyWork/tkitchen/.verification-evidence/verify-tkitchen/qa-02-6a725b1/review.md`.

- **QA-02 re-review: verdict pass** at `7090673f6b51fa3eea6002a3ee77539cdbc8dae2`. After a host-owner change, the real CLI returned 403 to the replacement owner without card membership and left the SQLite snapshot unchanged. The original owner could still move the card as a member. The full gate and all 11 focused tests passed.
- Re-review evidence: `F:/MyWork/tkitchen/.verification-evidence/verify-tkitchen/qa-02-7090673/review.md`.
