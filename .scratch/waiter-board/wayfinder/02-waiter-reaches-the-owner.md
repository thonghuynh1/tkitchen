# @waiter reaches the owner's machine

Type: grilling
Status: open
Blocked by:

## Parent

[Waiter board](../map.md). Ledger: [ledger.md](../ledger.md).

## Question

How does one `@waiter` message become exactly one Trigger in the host's tkitchen (board and kitchen on the same machine since D1): how the board writes it (tkitchen as a library, or a producer reading the board's store; K-bot, K-trigger), its id recipe so a resent message is not a second Trigger, and what members see while the waiter is busy or not running (K-offline)? K-machine is settled by D1: the host takes it.

Plugs into the placeholder from [Board and card chat](01-board-and-card-chat.md) (the "mentions waiter" flag), not its internals. Owns a placeholder for [The waiter reads and replies](03-waiter-reads-and-replies.md): a reply channel back to the card, which today posts a fixed "received" message.

Borrow (D9, patterns only): cookout's webhook-command delivery (a `callId` per call, 5 persisted retries with backoff, pending deliveries resumed on restart; its `app/modules/webhook-commands/lib/server/delivery.ts`). Not its mention trigger, which is one POST with no retry or idempotency (`app/modules/triggers/lib/server/mentions.ts`). Dedupe still belongs on the kitchen side.

## Slice when resolved

A member writes `@waiter …`; the host's kitchen records one Trigger (`source: board`, `thread: board:<card>`, `actor: github:<id>`) and the card shows "received"; a resent message makes no second Trigger.
