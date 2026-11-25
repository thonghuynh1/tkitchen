# How aiLau's cloud extension dials out

Type: research
Status: open
Blocked by:

## Parent

[Waiter board](../map.md). Feeds [@waiter reaches the owner's machine](02-waiter-reaches-the-owner.md).

## Question

How does aiLau's `cloud` extension connect a machine to a Cloudflare Worker + Durable Object over `wss://`: the protocol and messages, authentication of the machine, reconnect and backoff, delivery guarantees (at-least-once, acks, dedupe), and what it does while offline? Cite `path:symbol`. aiLau is not cloned on the work laptop (`thonghuynh1/aiLau`; home `F:\MyWork\aiLau`).

## Slice when resolved

Feeds ticket 02: which parts of that pattern the board's connector reuses.
