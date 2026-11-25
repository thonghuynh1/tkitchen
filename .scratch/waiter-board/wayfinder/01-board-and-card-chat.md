# Board and card chat

Type: grilling
Status: open
Blocked by:

## Parent

[Waiter board](../map.md). Ledger: [ledger.md](../ledger.md).

## Question

What does the board need so two GitHub users can work on one card: the repo name (K-name), how the host exposes its URL and whether the work laptop may (K-expose), the board page and where a user's list of cards lives (K-boardstore), invite links (one use or many, expiry) and removal that cuts access at once, open sockets included (K-invite), live chat in a card's Durable Object, and how long threads are kept and who may delete a card (K-retention)?

Owns a placeholder for [@waiter reaches the owner's machine](02-waiter-reaches-the-owner.md): the card records each message with a "mentions waiter" flag and an id, and today does nothing with it.

Borrow (D9, patterns only): cookout's SSE live updates, where ending a credential closes its open streams at once (its `docs/adr/0063-how-a-live-connection-ends.md`), for removal that cuts access; its one-level threads (`docs/adr/0006-a-reply-to-a-reply-attaches-to-the-parent.md`). UI is our own, shadcn (D10).

## Slice when resolved

Two people sign in with GitHub, one invites the other by link, both see the card on their boards and chat live; when the owner removes the other, the card disappears from their board and their open chat stops.
