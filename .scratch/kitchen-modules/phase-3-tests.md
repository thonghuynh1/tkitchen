# Phase 3: Tests through module entries

[Overview](overview.md)

## Goal

Unit tests live in their module's private `tests/` folder and import only `../index.ts`. Cross-cutting suites stay in the top-level `tests/` and import only module entries.

Progress (2026-11-26): phase 2's routing lever (`scripts/route-entries.mjs`) already pointed every test and suite import at module entries (`index.ts` or `adapters.ts`). What is left is moving the unit tests into module `tests/` folders, the tsconfig/vitest globs, and deleting both levers.

## Changes

- `tests/domain/*.test.ts` → `src/modules/triggers/tests/`, `src/modules/branches/tests/`.
- `tests/infrastructure/*.test.ts` → the owning module's `tests/` (git, forge, lock, triggers, config).
- `tests/cli`, `tests/sim`, `tests/contract`, `tests/quality`, `tests/deploy` stay. Their deep imports (listed in the exploration: `tests/sim/doubles/sim-store.ts:1`, `tests/sim/world/world.ts:4`, `tests/contract/*.contract.ts:2`, `tests/cli/walking-skeleton.test.ts:7` and others) switch to module entries.
- Anything a suite needs that is not yet on an entry, such as `setGitProcessGuard` and `createGitRunner`, is added to the owning `index.ts` on purpose, as a test seam.
- `tsconfig.json` `include` and `vitest.config.ts` pick up `src/**/tests/**`.
- `scripts/move-modules.mjs` is deleted.

## Data structures

None.

## Verification

Static: `npm run verify` exit 0, with the same test count as the baseline. A grep for `/lib/` in `tests/` and in `src/modules/*/tests/` finds nothing outside the module's own folder.

Runtime: verify-tkitchen journeys pass; sim `violations=0` at 200 seeds.
