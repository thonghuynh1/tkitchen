# Phase 4: Module seams in dependency-cruiser

[Overview](overview.md)

## Goal

The structure rules from phases 1 to 3 are enforced by dependency-cruiser, not by convention. The regex script keeps only what dependency-cruiser cannot see.

## Changes

- `dependency-cruiser` added as a devDependency. `.dependency-cruiser.cjs` (new, our own) holds these rules, each named as a sentence:
  - `entry-points-only-across-modules`: a file in module A may import module B only through `src/modules/B/index.ts` or `web.ts`.
  - `entry-points-only-from-outside`: `src/cli`, `src/web`, `src/index.ts` and `tests/` import module entries only.
  - `tests-folder-is-private`: nothing imports a `tests/` folder except files inside it.
  - `module-tests-through-own-entry`: a module's `tests/` imports its own `index.ts` or `web.ts`, never its `lib/`.
  - `node-only-in-adapters`: Node built-ins and `node:sqlite` are imported only from `lib/adapters/`, `src/cli/` and the top-level `tests/`.
  - `no-circular`, `no-undeclared-dependencies`.
- `package.json`: `seams` script; `verify` runs it after typecheck.
- `scripts/check-module-structure.mjs`: drop the import checks. Keep the environment rule (clock/random only in `platform`'s adapters) and the 800-line budget.
- `tests/quality/seams.test.ts` (new): one fixture tree per rule under `tests/quality/fixtures/seams/`, each failing with the rule's name, plus one clean tree that passes.
- `tests/quality/structure.test.ts`: drop the import-rule cases now owned by `seams.test.ts`.

## Data structures

- The rule list in `.dependency-cruiser.cjs`; each rule is `{ name, severity: "error", from, to }`.

## Verification

Static: `npm run verify` exit 0. Each fixture in `seams.test.ts` goes red with its rule's name before the rule exists, then green.

Runtime: a deliberate bad import (`src/modules/rounds/lib/round.ts` importing `../../git/lib/adapters/git-repo.ts`) makes `npm run seams` exit non-zero naming `entry-points-only-across-modules`. Revert it.
