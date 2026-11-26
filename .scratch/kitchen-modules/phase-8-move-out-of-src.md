# Phase 8: Move the kitchen out of src

[Overview](overview.md)

## Goal

`src/` belongs to the web app, and the kitchen modules sit in a top-level `modules/` folder, matching the ts-template layout where the program (`app/`) sits at the root with no `src/` around it. User decision, 2026-11-26, option C: match ts-template, `src` will be the web, modules will be a top folder. This phase is behavior-preserving. The web skeleton (now phase 9) then builds into the emptied `src/`.

## Changes

- `scripts/move-out-of-src.mjs` (new lever, deleted in phase 9). One path map. It runs `git mv`, rewrites relative imports and path strings in `modules/`, `cli/`, `index.ts`, `tests/` and `scripts/`, and rekeys `lint-baseline.json` so every count keeps its file. A second run finds nothing to move and exits 0.
- Moves: `src/modules/<module>/` → `modules/<module>/`, `src/cli/tkitchen.ts` → `cli/tkitchen.ts`, `src/index.ts` → `index.ts`. `src/` is left absent until phase 9 creates the web app in it.
- Path-keyed config follows the move: `.dependency-cruiser.cjs` patterns, `scripts/check-module-structure.mjs` prefixes and `collect` roots (`modules`, `cli`, `index.ts`), `tsconfig.json` include, `package.json` (`bin`, the `seams` argument list), the `.oxlintrc.json` override now targets `modules/**`, `cli/**` and `index.ts` instead of `src/**`.
- Hardcoded CLI paths outside `src/` follow in the same commit: `deploy/windows/install-task.ps1`, `.verification-skills/verify-tkitchen/scripts/vt.mjs`, `tests/helpers.ts`, `tests/cli/serve-lock.test.ts`.
- Fixtures that model the tree follow: `tests/quality/seams.test.ts` builds `modules/` and `cli/` trees, `tests/quality/lint.test.ts` lints its fixture under `modules/`, and the one directory climb in `modules/forge/tests/gh-timeout.test.ts` loses one `..`.
- Docs: `docs/MODULES.md`, `AGENTS.md`, this plan (phases renumbered: web is phase 9, board verb is phase 10, and web paths lose the `web/` segment so `src/main.tsx` is the entry), and ADR 0003 records that `src/` is the web app and amends ADR 0001's layout.

## Data structures

- `MovePlan = ReadonlyArray<{ from: string; to: string }>`: the single table the lever reads, same shape as phase 1.

## Verification

Static: `npm run verify` exit 0, with one stated exception. The lint ratchet compares baseline counts per file path against the merge base, so a renamed file with baselined counts reads as a raise from zero until the merge base contains the rename. On the move commit, `LINT_RATCHET_BASE=HEAD npm run lint` proves the rekey preserved every count; a plain `npm run lint` passes once the commit is on `origin/main`. The seams path changes are flagged by `lint:guard`; the commit carries `Lint-approved-by: Thong` for the path renames the user approved with option C. `git diff --stat -M` shows renames, with content changed only on import and path lines.

Runtime: the verify-tkitchen journeys pass on the real CLI at its new path. The sim line reads `seeds=200 violations=0`, the same as the baseline before the move.
