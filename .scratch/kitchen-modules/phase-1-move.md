# Phase 1: Move files into modules

[Overview](overview.md)

## Goal

Every `src/` file lives in its target module (overview, Target layout). Behavior is unchanged, and `ports.ts` is still one file for now (it moves to `src/modules/platform/lib/ports.ts` temporarily and is split in phase 2).

## Changes

- `scripts/move-modules.mjs` (new). It reads one table of old path → new path, runs `git mv` for each file, and rewrites every relative import in `src/`, `tests/` and `scripts/` that pointed at a moved file. It is idempotent: a second run finds nothing to move and exits 0. It is a throwaway lever and is deleted at the end of phase 3.
- `src/**`: moved by the script. Pure files go to `lib/`; files that import `node:*`, spawn processes or open SQLite go to `lib/adapters/`. `src/cli/tkitchen.ts` stays where it is.
- `scripts/check-module-structure.mjs`: path prefixes updated so the inward rule reads as "only `lib/adapters/` and `src/cli/` may import Node built-ins". The environment rule now allows only `src/modules/platform/lib/adapters/`.
- `docs/MODULES.md`: one paragraph saying the layout is in transition, pointing at this plan.

## Data structures

- `MovePlan = ReadonlyArray<{ from: string; to: string }>`: the single table the lever reads.

## Verification

Static: `npm run verify` exit 0. `git diff --stat -M` shows renames, with each file's content changed only on import lines.

Runtime: the verify-tkitchen journeys pass on the real CLI. The sim line reads `round seeds=200 violations=0`, the same as the baseline.
