# 0002: Borrow cookout's patterns, not its code

Status: accepted, 2026-11-25 (user; waiter-board ledger D9, with D10 for the UI).

## Context

mattpocock/cookout already does much of what the waiter board needs: live threads, mention parsing, webhook delivery, and a module layout checked by lint. Forking it was the obvious first idea.

## Decision

tkitchen borrows cookout's patterns and writes its own code. No cookout file is copied, and every rule is rewritten from a one-line description in our own words.

Reasons:

- cookout has no license (no LICENSE file, GitHub reports `license: null`, and `@ai-hero/cookout` on npm has no license field), so its code is all rights reserved.
- It changes very fast: about 200 tickets a day, v0.8.0, created 2026-11-22.
- Its server is Effect v4 throughout; tkitchen is plain TypeScript.
- It lacks what the board needs most: GitHub sign-in, per-card membership and invites, exactly-once mention delivery, and a kanban.

Patterns taken: vertical modules with a public entry and private internals and tests; seams checked by dependency-cruiser; a per-file, per-rule lint ratchet; a guard against loosening lint; small generic lint rules (context terms, no unsafe `as`, no pass-through files, branded ids); and, for the board, SSE streams that close when a credential is revoked, and webhook delivery with a call id, persisted retries and resume on restart.

Not taken: cookout's UI lint (one component per file, no ternaries), because it fights the components shadcn/ui generates (D10); its Effect usage; its merge-ticket flow; and its mention delivery, which is one POST with no retry.

## Consequences

- No license question ever reaches tkitchen's code.
- Where a borrowed idea needs adapting, we decide it ourselves; nothing tracks cookout's changes.
