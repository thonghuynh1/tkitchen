# Board and card chat

Type: grilling
Status: resolved
Blocked by:

## Parent

[Waiter board](../map.md). Ledger: [ledger.md](../ledger.md).

## Question

What does the board need so two GitHub users can work on one card: the repo name (K-name), how the host exposes its URL and whether the work laptop may (K-expose), the board page and where a user's list of cards lives (K-boardstore), invite links (one use or many, expiry) and removal that cuts access at once, open sockets included (K-invite), live chat in a card's Durable Object, and how long threads are kept and who may delete a card (K-retention)?

Owns a placeholder for [@waiter reaches the owner's machine](02-waiter-reaches-the-owner.md): the card records each message with a "mentions waiter" flag and an id, and today does nothing with it.

Borrow (D9, patterns only): cookout's SSE live updates, where ending a credential closes its open streams at once (its `docs/adr/0063-how-a-live-connection-ends.md`), for removal that cuts access; its one-level threads (`docs/adr/0006-a-reply-to-a-reply-attaches-to-the-parent.md`). UI is our own, shadcn (D10).

## Resolution (2026-11-26)

Resolved in [ledger.md](../ledger.md) (D12–D18; K-name previously closed by D11; Worker/DO/D1 superseded by D1/D8/D11):
- **D12 (`K-expose`)**: `tkitchen board` takes `--public-url <url>` (defaults to local bind URL), staying tunnel-agnostic. Home PC routes `board.<domain>` via Cloudflare Named Tunnel (no Cloudflare Access in front); work laptop stays localhost-only.
- **D13 (`K-auth-local`)**: Single host owner (`ownerGithubId`, `github:<numeric id>`). Only the host owner creates cards, invites, removes members, or soft-deletes cards; invitees see only their cards; strangers see an empty board and get `403` on writes.
- **D14 (`K-invite`)**: At most one active multi-use invite link per card (no expiry). "Close sharing" revokes the link, kicks all non-owner members, and closes their SSE handles immediately. Individual removal kicks that member, closes their SSE handle, and revokes the active link. "Create invite link" generates a fresh token (old tokens stay dead).
- **D15 (`K-boardstore`)**: Separate `~/.tkitchen/board.db` beside `kitchen.db`; `kitchen.db` and `modules/triggers` stay untouched.
- **D16 (`K-chat-live`)**: Single per-user SSE stream (`GET /v1/stream`) + HTTP `POST` writes + `?after=<seq>` catch-up on reconnect; 1-level threads (D9); `Todo / Doing / Done` column moves (D5).
- **D17 (`K-retention`)**: Messages kept forever in `board.db`; host owner soft-deletes cards (`archived_at = now`), revoking invites and closing non-owner SSE streams immediately (no archive viewer in Slice 1).
- **D18 (`K-waiter-placeholder`, placeholder for Ticket 02)**: Messages store `id: MessageId` + `mentionsWaiter: boolean` (`parseMentionsWaiter` matches word-boundary case-insensitive `@waiter` outside code spans; no Trigger yet); composer includes a `@` mention picker for `@waiter`.

## Slice when resolved

Two people sign in with GitHub, one invites the other by link, both see the card on their boards and chat live; when the owner removes the other, the card disappears from their board and their open chat stops.

## Slice outcomes

### Slice 1 — Board and card chat

- Cut: 2026-11-26
- Base: `C:/Hackathon/tkitchen` @ `3bc6f97e7b43348967bc89b9525cceb8f9d935d4` (uncommitted `.scratch/waiter-board/*` and `.verification-skills/verify-tkitchen/features/waiter-board.md`)
- Delivery status: Planned — implementation and `/indicate` pending
- Intent: Let a host owner run `tkitchen board` on their own machine, invite friends by link over GitHub sign-in, and collaborate in live card threads while keeping full instant revocation control and leaving `kitchen.db` untouched.
- Expected end result: Two GitHub users can sign in on the host's board, join a card via a multi-use invite link, move cards across `Todo / Doing / Done`, chat live in 1-level threads with a `@waiter` mention picker, catch up missed messages on reconnect, and immediately lose access (card removed + SSE stream closed) when removed, when sharing is closed, or when the owner soft-deletes the card.
- In this slice: `modules/identities`, `modules/cards`, `modules/chat`, `modules/live`, extended `modules/board-http` and `modules/cli` (`--public-url`), `~/.tkitchen/board.db`, React + shadcn web UI in `src/` (via `modules/*/web.ts`), deterministic simulation + model trace conformance (`sim/board.sim.ts`), and home-PC HITL smoke.
- Not in this slice: `@waiter` Trigger emission to `kitchen.db` and bot replies (Tickets 02 & 03), archive viewer/restore UI, notifications, cloud hosting, cross-host board sync, and work-laptop public exposure.
- Decisions: [01-board-and-card-chat.md](01-board-and-card-chat.md), [ledger.md](../ledger.md) (D1–D5, D7–D18)
- Issues:
  - [01-identities-and-oauth.md](../issues/01-identities-and-oauth.md)
  - [02-cards-invites-and-archive.md](../issues/02-cards-invites-and-archive.md)
  - [03-card-chat-and-live-sse.md](../issues/03-card-chat-and-live-sse.md)
  - [04-board-dst-and-model-conformance.md](../issues/04-board-dst-and-model-conformance.md)
  - [05-board-web-ui.md](../issues/05-board-web-ui.md)
  - [06-hitl-live-github-and-tunnel-smoke.md](../issues/06-hitl-live-github-and-tunnel-smoke.md)
- Verification feature: [.verification-skills/verify-tkitchen/features/waiter-board.md](../../../.verification-skills/verify-tkitchen/features/waiter-board.md)

```gherkin
Feature: Waiter board and live card chat

  Scenario: Owner signs in and strangers cannot create cards
    Given `tkitchen board` is running with `--public-url` and a pinned `ownerGithubId`
    When Owner and stranger Bob each sign in with GitHub
    Then Owner can create cards and see all their active cards
    And Bob sees an empty board and receives 403 if he tries to create a card

  Scenario: Multi-use invite, individual removal, and Close sharing
    Given Owner created Card 1 and generated invite link T1
    When Alice and Charlie redeem T1, then Owner removes Alice, then Owner clicks Close sharing
    Then Alice loses access to Card 1 immediately and T1 returns 410 on replay while Charlie stays
    And Close sharing kicks Charlie immediately, revokes invites, and a fresh link T2 lets people join again

  Scenario: Live SSE chat, 1-level threads, reconnect catch-up, and instant revocation
    Given Owner and Alice are members of Card 1 with `GET /v1/stream` open
    When they chat (including replying to a reply and mentioning `@waiter`), Alice briefly disconnects and reconnects, and Owner later removes Alice
    Then replies-to-replies attach to the parent message, `@waiter` outside code sets `mentionsWaiter = true` without touching `kitchen.db`
    And Alice catches up missed messages via `?after=<seq>` on reconnect
    And upon removal Alice's SSE stream closes immediately, Card 1 disappears from her board, and post-removal messages never reach her

  Scenario: Owner soft-deletes a card
    Given Card 1 has active messages and members
    When Owner deletes Card 1
    Then `archived_at` is set in `board.db`, active invites are revoked, non-owner SSE streams close immediately, and Card 1 vanishes from all boards
```

- Scenario coverage:
  - *Owner signs in and strangers cannot create cards* → `01-identities-and-oauth.md` (AC1–AC4), `02-cards-invites-and-archive.md` (AC1), `05-board-web-ui.md` (AC2)
  - *Multi-use invite, individual removal, and Close sharing* → `02-cards-invites-and-archive.md` (AC1–AC3), `04-board-dst-and-model-conformance.md` (AC1–AC3), `05-board-web-ui.md` (AC2)
  - *Live SSE chat, 1-level threads, reconnect catch-up, and instant revocation* → `03-card-chat-and-live-sse.md` (AC1–AC4), `04-board-dst-and-model-conformance.md` (AC1–AC3), `05-board-web-ui.md` (AC2), `06-hitl-live-github-and-tunnel-smoke.md` (AC1)
  - *Owner soft-deletes a card* → `02-cards-invites-and-archive.md` (AC3), `03-card-chat-and-live-sse.md` (AC3), `04-board-dst-and-model-conformance.md` (AC1–AC3), `05-board-web-ui.md` (AC2)
- Indicate outcome: Pending — no delivery claim yet
