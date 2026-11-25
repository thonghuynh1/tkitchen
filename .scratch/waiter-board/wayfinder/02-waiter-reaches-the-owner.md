# @waiter reaches the owner's machine

Type: grilling
Status: open
Blocked by: 04

## Parent

[Waiter board](../map.md). Ledger: [ledger.md](../ledger.md).

## Question

How does one `@waiter` message become exactly one Trigger on the card owner's machine: what connects the machine to the board (a small connector, a tkitchen producer, or aiLau's cloud extension; K-bot), where the Trigger is first written and how it is delivered once across reconnects and retries (K-trigger), what members see when the owner's machine is offline (K-offline), and which machine takes it when both are online (K-machine, tkitchen K6)?

No prior art: aiLau's cloud extension is HTTPS backup, not a live connection ([ticket 04](04-ailau-cloud-pattern.md)); identity, revocation, per-card routing and delivery guarantees are designed here.

Plugs into the placeholder from [Board and card chat](01-board-and-card-chat.md) (the "mentions waiter" flag), not its internals. Owns a placeholder for [The waiter reads and replies](03-waiter-reads-and-replies.md): a reply channel back to the card, which today posts a fixed "received" message.

## Slice when resolved

A member writes `@waiter …`; within seconds the owner's machine records one Trigger (`source: board`, `thread: board:<card>`, `actor: github:<id>`), the card shows "received", and an offline machine shows "waiting" until it connects.
