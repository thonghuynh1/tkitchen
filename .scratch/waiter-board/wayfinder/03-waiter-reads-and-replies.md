# The waiter reads and replies

Type: grilling
Status: open
Blocked by:

## Parent

[Waiter board](../map.md). Ledger: [ledger.md](../ledger.md).

## Question

What does the bot get from the thread and how does it answer: whole thread or since the last `@waiter`, a size cap, other people's text as untrusted (ids + summaries, full text behind recall; K-context); the reply as a `waiter` member, one final message or streamed (K-reply); and which agent runs it in v1 (a plain Pi on the owner's machine, aiLau, a durable Pi)?

Plugs into the reply-channel placeholder from [@waiter reaches the owner's machine](02-waiter-reaches-the-owner.md), not its internals.

## Slice when resolved

A ping gets a real answer from the bot in the thread, built from the thread's context, with the Trigger's Disposition recording what the bot did.
