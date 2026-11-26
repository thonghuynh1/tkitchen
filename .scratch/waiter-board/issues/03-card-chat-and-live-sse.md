---
repo: C:/Hackathon/tkitchen
slice: 1
parent_tickets: [01-board-and-card-chat]
covers_decisions: [D9, D14, D15, D16, D17, D18]
status: open
labels: [ready-for-agent]
---

## Parent

- Wayfinder map: `.scratch/waiter-board/map.md`
- Slice: 1
- Originating ticket & slice promise: `.scratch/waiter-board/wayfinder/01-board-and-card-chat.md#slice-1--board-and-card-chat`

## What to build

Build `modules/chat/` (1-level threads, monotonic `seq`, `@waiter` placeholder parser) and `modules/live/` (in-process per-user SSE hub with immediate stream revocation), and wire them into `modules/board-http/` so members chat live over `GET /v1/stream`, catch up missed messages via `?after=<seq>`, and lose live access the instant they are removed or the card is archived. Covers **D9**, **D14**, **D15**, **D16**, **D17**, **D18**, **INV-001**, **INV-003**, **INV-004**, and **PRG-001**.

## Implementation map

### Accepted decisions & contracts (carry verbatim)

- **D9 (One-level threads)**: `POST /v1/cards/:id/messages { text: string, parentId?: MessageId | null }`.
  - If `parentId` is null/omitted → top-level message (`parentId = null`).
  - If `parentId` points to a top-level message on the same card → saved with `parentId = target.id`.
  - If `parentId` points to a reply whose own `parentId` is `P` → saved with `parentId = P` (flattens reply-to-reply onto the parent).
  - If `parentId` does not exist on that card → `400` with zero rows written.
- **D18 (`@waiter` placeholder for Ticket 02)**:
  - Every saved message has `{ id: MessageId, cardId: CardId, seq: number, parentId: MessageId | null, authorId: UserId, authorLogin: string, text: string, mentionsWaiter: boolean, createdAt: string }`.
  - `parseMentionsWaiter(text)`: strips fenced `` ```...``` `` and inline `` `...` `` code spans, then tests `/(^|[^\w])@waiter(?=$|[^\w])/i`.
  - Examples: `"hey @Waiter, check this"` → `true`; `"@waiter: help"` → `true`; `"alice@waiter.io"` → `false`; ``"`@waiter`"`` → `false`; `"@waiters"` → `false`.
  - Slice 1 does nothing else when `mentionsWaiter === true` (never writes to `kitchen.db`).
- **D16 (Single per-user SSE stream + `?after=<seq>` catch-up)**:
  - `GET /v1/stream` (authenticated): opens `text/event-stream` (`Cache-Control: no-cache`, `Connection: keep-alive`), registers the handle under `user.id` in `LiveHub`.
  - Events pushed (filtered to current members of the card):
    - `card_created` `{ card }`
    - `card_moved` `{ cardId, column }`
    - `message_created` `{ message }`
    - `card_removed` `{ cardId }` (sent on member removal, Close sharing, or card soft-delete)
  - `GET /v1/cards/:id/messages?after=<seq>` (current member or owner only; non-member → `403`, archived → `404`): returns `{ ok: true, messages }` with `seq > after` ordered by `seq ASC` (default `after = 0`).
  - `POST /v1/cards/:id/messages` (current member or owner only; non-member → `403`, archived → `404`, empty trimmed text → `400`): persists with strictly monotonic `seq` per card in `board.db`, fans out `message_created` only to current card members with open SSE handles.
- **D9 / D14 / D17 (Immediate stream revocation)**:
  - When `DELETE /v1/cards/:id/members/:userId`, `POST /v1/cards/:id/close-sharing`, or `DELETE /v1/cards/:id` succeeds, `board-http` synchronously calls `liveHub.revokeCardAccess(cardId, removedUserIds)`:
    1. Emits `event: card_removed` `{ cardId }` to each removed user's open SSE handle(s),
    2. Immediately calls `end()` on those handles (and unregisters them from `LiveHub`) **before** returning the HTTP response, so no subsequent `message_created` can ever flush to a removed user (`INV-001`, `INV-003`, `INV-004`).

### Blocking-edge wiring (from Issue 02)

- **Producer**: `02-cards-invites-and-archive.md` provides `modules/cards/` (`CardId`, `CardStore`, `isMember`, `listMemberIds`, and `removedUserIds` returned by remove/close-sharing/archive).
- **Consumer**: `modules/chat/` uses `CardId` and checks active card membership; `modules/board-http/` wires `cards` mutations to `LiveHub` (`broadcast` on create/move, `revokeCardAccess` on remove/close-sharing/archive).
- **Wiring owner**: `modules/cli/lib/adapters/run.ts` constructs `SqliteChatStore(join(kitchenHome(), "board.db"))` and `InMemoryLiveHub`, passing both into `startBoardServer`.

### Callers of changed symbols

- `modules/board-http/lib/contract.ts`, `modules/board-http/lib/adapters/server.ts`: **required edit** — add `chat` and `live` options, route `/v1/stream` and `/v1/cards/:id/messages`, hook card mutations to `LiveHub`.
- `modules/cli/lib/adapters/run.ts`: **required edit** — wire `SqliteChatStore` and `InMemoryLiveHub` into `runBoard`.
- `index.ts`: **required edit** — export `modules/chat` and `modules/live` entries.

### Mechanics left to implementer

- SSE heartbeat comment interval (`: keepalive\n\n`), exact SQLite DDL for `messages` in `board.db`, and internal helper layout in `modules/chat/lib/` and `modules/live/lib/`.

## Acceptance criteria

- [ ] `parseMentionsWaiter` and 1-level thread flattening satisfy all edge cases in pure unit tests
  - Run: `npx vitest run modules/chat/tests/`
  - Test: `planned` → `modules/chat/tests/chat.test.ts` → `flattens reply-to-reply onto parent and parses @waiter outside code spans`
  - Expected: replying to a reply stores the root `parentId`; invalid `parentId` rejects without writing; `"hey @Waiter"` → `true`, `"alice@waiter.io"` / ``"`@waiter`"`` / `"@waiters"` → `false`.
  - Fails when: 2-level nesting is saved or email/code spans return `mentionsWaiter: true`.

- [ ] Live SSE delivers messages to members in real time, and a disconnected member catches up missed messages via `GET /v1/cards/:id/messages?after=<seq>` (`PRG-001`)
  - Run: `npx vitest run modules/board-http/tests/live-chat.test.ts`
  - Test: `planned` → `modules/board-http/tests/live-chat.test.ts` → `streams live messages over SSE and catches up missed messages after disconnect`
  - Expected: Alice receives `message_created` for seq 1 over `/v1/stream`; after disconnecting while Owner posts seq 2, Alice fetches `?after=1` and receives `[seq 2]`.
  - Fails when: SSE omits `message_created` or `?after=1` drops or duplicates seq 2.

- [ ] Removing Alice, Close sharing, or archiving a card immediately sends `card_removed`, closes Alice's SSE stream, and blocks post-removal messages and catch-up (`INV-001`, `INV-003`, `INV-004`)
  - Run: `npx vitest run modules/board-http/tests/live-chat.test.ts`
  - Test: `planned` → `modules/board-http/tests/live-chat.test.ts` → `removal, close-sharing, and archive immediately end SSE streams and prevent post-removal leaks`
  - Expected: Alice's SSE stream closes immediately upon removal/Close sharing/archive; subsequent `POST /v1/cards/:id/messages` by Owner never arrives on Alice's handle, and Alice's `GET /v1/cards/:id/messages?after=0` returns `403` (removed) or `404` (archived).
  - Fails when: SSE stream stays open after removal or Alice reads messages posted after removal.

- [ ] Messages persist across a `SqliteChatStore` / server restart, and `kitchen.db` stays untouched even when `mentionsWaiter: true`
  - Run: `npx vitest run modules/board-http/tests/live-chat.test.ts`
  - Test: `planned` → `modules/board-http/tests/live-chat.test.ts` → `persists messages across restart and writes nothing to kitchen.db`
  - Expected: after closing and restarting `startBoardServer` against the same `board.db`, `GET /v1/cards/:id/messages` returns prior messages with `mentionsWaiter: true`, and `kitchen.db` does not exist.
  - Fails when: messages are memory-only or `kitchen.db` is written.

- [ ] Full repo verification passes
  - Run: `npm run verify`
  - Test: repo gate
  - Expected: exit 0.
  - Fails when: any seam, lint, structure, type, or test check fails.

## Blocked by

- Local: `02-cards-invites-and-archive.md`

## Independent QA

- Verdict: **fail** at `4c1d411d484b132d1b7a5f4239c2448506542d5d`.
- D16: the real CLI returned 403 for both chat GET and POST after a restart with a replacement configured host owner who had no membership row. `/v1/me` confirmed `isOwner: true`. The route contract allows the owner; expected 200 and 201 respectively.
- The fresh repo gate, seven focused tests, and the ordinary CLI chat, catch-up, revocation, and persistence checks passed.
- Evidence: [Initial QA review](../../../.verification-evidence/verify-tkitchen/qa-03-4c1d411/review.md).

### Re-review

- Verdict: **pass** at `1cbfc8edc1c6e70552a858bf73262584929762ed`. This supersedes the initial verdict.
- The replacement configured owner now gets 200/201 on active chat without a membership row. Ordinary non-members still get 403, archived chat still gets 404, and chat SSE remains member-only.
- The fresh repo gate, eight focused tests, and the isolated CLI checks passed.
- Evidence: [QA re-review](../../../.verification-evidence/verify-tkitchen/qa-03-1cbfc8e/review.md).
