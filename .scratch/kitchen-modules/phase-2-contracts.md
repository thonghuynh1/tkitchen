# Phase 2: Each module owns its contracts

[Overview](overview.md)

## Goal

`ports.ts` is gone. Each contract lives in the module that owns it and is exported from that module's `index.ts`. Every module has an `index.ts` exposing only what consumers use today.

## Changes

- Split the temporary `src/modules/platform/lib/ports.ts` by owner:
  - `Clock`, `Scheduler`, `Random`, `Ids` → `platform`.
  - `GitRepo` → `git`.
  - `Forge`, `PullRequest` → `forge`.
  - `Store`, `RoundStatus` → `triggers`.
  - `Lock` → `lock`.
  - `Config`, `KitchenConfig`, `RepoConfig` → `config`.
  - `PortError` goes to whichever module the `architect` pass decides; candidate is `platform`.
- `src/modules/*/index.ts` (new, one per module): re-exports the contract types, the pure operations, and the adapter classes the CLI and the suites construct (`GitRepoImpl`, `KitchenStore`, `FileLock`, `GitHubForge`, `SystemClock` and the rest).
- `src/index.ts`: re-exports module entries only.
- Callers in `src/` switch to `../<module>/index.ts` imports. Old deep paths are deleted in the same commit, per Migrate Callers Then Delete Legacy APIs.

## Data structures

No new types. Every contract keeps its current shape and moves file only.

## Verification

Static: `npm run verify` exit 0. `grep -r "ports.ts" src tests` finds nothing.

Runtime: verify-tkitchen journeys pass; sim `violations=0` at 200 seeds.
