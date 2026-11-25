# Phase 7: Generic lint rules and docs

[Overview](overview.md)

## Goal

The generic rules borrowed as ideas (D9) are on, existing violations sit in the ratchet baseline, and the docs describe the new structure.

## Changes

- `scripts/oxlint/` (beside the existing `no-comments.js`), each rule written from its one-line description:
  - `context-terms`: identifiers may not use a word that a `CONTEXT.md` term lists under `_Avoid_`, such as `event` outside the store or `handler`.
  - `no-unsafe-as`: no `as` casts except `as const` and casts to a generic type parameter.
  - `no-pass-through`: no file whose only content is re-exports of one other file. Module `index.ts` files are exempt.
  - `branded-ids`: an exported type or parameter named `*Id` may not be a bare `string` or `number`.
- `.oxlintrc.json`: the four rules at `error`. `npm run lint:baseline` records the existing violations, and the commit carries the trailer, since adding rules passes the guard.
- `docs/MODULES.md`: rewritten for the module layout, the seams, the ratchet and the guard.
- `docs/adr/0001-vertical-modules.md`: the choice and the two rejected shapes from the overview.
- `docs/adr/0002-borrow-cookout-patterns-not-code.md`: D9 with its reasons.
- `AGENTS.md`: tkitchen now also hosts the waiter board; point to `docs/MODULES.md` and the checks.
- `CONTEXT.md`: Thread kind `board:<card>` and Trigger source `board`, marked proposed until waiter-board ticket 02 settles them.

## Data structures

None new.

## Verification

Static: `npm run verify` exit 0. Each rule has a fixture in `tests/quality/lint.test.ts` that fails without it.

Runtime: none beyond the CLI journeys, which must still pass.
