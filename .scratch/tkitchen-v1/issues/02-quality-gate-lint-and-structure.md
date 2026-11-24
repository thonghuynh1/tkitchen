---
repo: F:/MyWork/tkitchen
status: closed
type: AFK
covers: [DEC-011 (enforcement), DEC-013, RB-010]
---

## Parent

`.scratch/tkitchen-v1/PRD.md`

## What to build

The repo's quality gate, copied from tstack: oxlint with tstack's rules (snapshot tstack `bfa26c76`), the no-comments plugin, a module-structure checker (layer rule, env rule, 800-line budget), and `npm run verify`. The code from issue 01 must pass it.

## Implementation map

**Producer → consumer**: issue 01 provides `package.json`, `src/**` in the DEC-011 layout and `tests/**`. This issue adds scripts to that `package.json` and makes that code pass.

**`.oxlintrc.json`** (DEC-013; source `F:/MyWork/tstack/.oxlintrc.json` at `bfa26c76`, GROUND-012):
- `"plugins": ["typescript", "unicorn", "oxc", "import"]`, `"jsPlugins": ["./scripts/oxlint/no-comments.js"]`, `"options": { "typeAware": true }`, `"categories": { "correctness": "off" }`, `"ignorePatterns": [".scratch"]`.
- Rules (all `"error"`): `eslint/max-lines` `{max:1000}`, `eslint/complexity` `{max:20}`, `eslint/no-else-return`, `eslint/eqeqeq`, `eslint/no-eval`, `import/no-self-import`, `tkitchen/no-comments`, `typescript/no-floating-promises`, `typescript/no-misused-promises`, `typescript/use-unknown-in-catch-callback-variable`, `typescript/only-throw-error`, `eslint/no-promise-executor-return`, `typescript/switch-exhaustiveness-check` `{allowDefaultCaseForExhaustiveSwitch:true, considerDefaultExhaustiveForUnions:true}`, `typescript/unbound-method`, `typescript/no-confusing-non-null-assertion`, `typescript/no-non-null-assertion`, `typescript/no-unnecessary-type-assertion`, `typescript/no-unsafe-argument`, `typescript/no-unsafe-assignment`, `typescript/no-unsafe-call`, `typescript/no-unsafe-member-access`, `typescript/no-unsafe-return`, `typescript/no-unsafe-type-assertion`, `unicorn/prefer-set-has`, `typescript/consistent-type-imports` `{disallowTypeAnnotations:false}`, `import/consistent-type-specifier-style` `"prefer-top-level"`.
- Overrides:
  - `src/**`: `eslint/no-magic-numbers` `{ignore:[-1,0,1], ignoreArrayIndexes:true, ignoreNumericLiteralTypes:true, enforceConst:true, detectObjects:true}`.
  - `scripts/**`: `eslint/complexity` off; `no-unnecessary-type-assertion`, `no-non-null-assertion`, all `no-unsafe-*` incl. `no-unsafe-type-assertion` off.
  - `**/*.js`, `**/*.mjs`, `**/*.cjs`: the five `no-unsafe-*` (not `-type-assertion`) off.
  - `**/fixtures/**`, `**/*.d.ts`: `eslint/no-magic-numbers` off.
  - `**/tests/**`, `**/*.test.*`, `**/*.sim.ts`: `max-lines`, `complexity`, `no-magic-numbers`, `no-non-null-assertion`, `only-throw-error`, `unbound-method`, all six `no-unsafe-*` off.
- **No exemption** for `no-unsafe-type-assertion` anywhere in `src/` (tstack exempts its journal; tkitchen's sqlite rows go through a typed reader).
- Not copied: `no-retired-names`, companion/live-script/`scripts/support` overrides.
- Type-aware backend: copy whatever makes `npm run lint` work in `F:/MyWork/tstack` (check its `node_modules` and `npx oxlint --help`); record what you found in `docs/MODULES.md`.

**`scripts/oxlint/no-comments.js`**: copy `F:/MyWork/tstack/scripts/oxlint/no-comments.js`, rename the plugin `meta.name` to `"tkitchen"`. Rule reports every comment except `Shebang`. Files that must keep a contract comment use `/* oxlint-disable tkitchen/no-comments -- <reason> */` (tstack precedent: `src/cli/journal-export.ts` line 1).

**`scripts/check-module-structure.mjs`** (precedent `F:/MyWork/tstack/scripts/check-module-structure.mjs` → `inspectImports`, `MAX_MODULE_LINES = 800`): over `src/**/*.ts`:
- a file under `src/domain/` importing a relative path outside `src/domain/` → error `src/domain stays pure and may import only src/domain`;
- a file under `src/domain/` or `src/application/` importing from `src/infrastructure/` or `src/cli/` → error;
- outside `src/infrastructure/`, any of `Date.now(`, `new Date(` with no arguments, `setTimeout(`, `setInterval(`, `Math.random(`, `randomUUID(` → error `use the Clock/Scheduler/Random/Ids port`;
- any file over 800 lines → error.
Exports a pure `inspect(files)` for tests; CLI exits 1 on any error.

**`package.json` scripts**: `"lint": "oxlint"`, `"verify:structure": "node scripts/check-module-structure.mjs"`, `"verify": "npm run lint && npm run typecheck && npm run verify:structure && npm test && npm run test:sim --if-present"`; devDependency `"oxlint": "^1.94.0"`.

**`docs/MODULES.md`**: the four layers, the dependency rule, the env rule, the 800-line budget.

**Mechanics left to the implementer**: fixture file names, checker internals.

## Acceptance criteria

- [x] Existing code passes the gate
  - Run: `npm run verify`
  - Expected: exit 0 on the tree from issue 01.
  - Fails when: any rule above is violated by `src/` or `tests/`.
- [x] Floating promise fails lint
  - Run: `npm test -- tests/quality/lint.test.ts`
  - Test: `tests/quality/lint.test.ts` → one case per fixture in `tests/quality/fixtures/lint/` (planned): copies the fixture to `src/__lint_fixture__.ts` (or `tests/__lint_fixture__.test.ts` for the test-scope cases), runs `npx oxlint <that path>`, deletes it.
  - Expected: non-zero exit and the output names `no-floating-promises`.
  - Fails when: the rule is missing or `typeAware` is off.
- [x] A comment fails lint
  - Run: `npm test -- tests/quality/lint.test.ts`
  - Expected: the comment fixture fails naming `tkitchen/no-comments`; a fixture with only a shebang passes.
  - Fails when: the plugin is not loaded or reports shebangs.
- [x] A magic number in `src/` fails, in tests it passes
  - Run: `npm test -- tests/quality/lint.test.ts`
  - Expected: `const t = 15 * 60000` in `src/__lint_fixture__.ts` fails naming `no-magic-numbers`; the same line in `tests/__lint_fixture__.test.ts` passes.
  - Fails when: the override scopes are wrong.
- [x] Non-exhaustive switch fails
  - Run: `npm test -- tests/quality/lint.test.ts`
  - Expected: a `switch` over `"behind" | "up_to_date" | "needs_base" | "ambiguous"` missing `ambiguous` (no default) fails naming `switch-exhaustiveness-check`.
  - Fails when: the rule is missing.
- [x] Unsafe `as` cast fails in `src/`
  - Run: `npm test -- tests/quality/lint.test.ts`
  - Expected: `const row = db.prepare("…").get() as { id: string }` in `src/__lint_fixture__.ts` fails naming `no-unsafe-type-assertion`.
  - Fails when: the rule is off or exempted for `src/`.
- [x] Layer rule
  - Run: `npm test -- tests/quality/structure.test.ts`
  - Expected: `inspect({"src/domain/x.ts": "import { a } from \"../infrastructure/y.ts\";"})` returns one error containing `src/domain stays pure`; `src/application/x.ts` importing `../infrastructure/y.ts` returns one error; `src/infrastructure/x.ts` importing `../domain/y.ts` returns none.
  - Fails when: the checker only checks one direction.
- [x] Env rule
  - Run: `npm test -- tests/quality/structure.test.ts`
  - Expected: `Date.now()` in `src/application/x.ts` → one error naming the Clock port; the same in `src/infrastructure/env.ts` → none; `Math.random()` in `src/domain/x.ts` → one error.
  - Fails when: any of the six patterns is not checked.
- [x] Module budget
  - Run: `npm test -- tests/quality/structure.test.ts`
  - Expected: an 801-line `src/domain/x.ts` → one error; 800 lines → none.
  - Fails when: the limit is off by one or not applied.

## Blocked by

- Local: `01-walking-skeleton-round-and-notices.md` — provides `package.json`, the DEC-011 layout under `src/`, and `src/infrastructure/env.ts` as the only home of `Date`/timers/random/ids. Proof the edge is connected: `npm run verify` above runs over that tree.

## Comments

Implemented by eng-02: oxlint gate (typeAware via tsrs copied from tstack), tkitchen/no-comments plugin, scripts/check-module-structure.mjs with pure inspect(files), docs/MODULES.md, quality tests under tests/quality/, and src fixes so the issue 01 tree passes. `npm run verify` exits 0 (lint, typecheck, structure, 27 tests). Evidence: F:/MyWork/tkitchen/.verification-evidence/eng-02-evidence.md. Independent review by qa-02 completed with verdict: fail. Full gate passes 27/27, but valid compact imports such as `import{a}from"../infrastructure/y.ts";` bypass layer enforcement in `scripts/check-module-structure.mjs:21`; both inspect() and CLI accept the forbidden dependency (CLI exit 0). Evidence and rerunnable probes: F:/MyWork/tkitchen/.verification-evidence/qa-02-review.md and qa-02-probes.test.mjs; 12 probes pass and 4 fail. Reviewed HEAD is 8308f71146fba6d5dc532e1c309e1c4bd632e432, but implementation files are untracked in the reviewed working tree, so the report records file hashes rather than attributing implementation to that commit. Engineering repair and re-review remain.

## Repair round 1 (eng-02)

QA02-1 fixed: importSpecifiers in scripts/check-module-structure.mjs now recognizes compact import/re-export/side-effect syntax (whitespace optional as in TypeScript). Five regression tests added to tests/quality/structure.test.ts including a CLI exit-1 test. qa-02 probes rerun 16/16 pass; npm run verify exit 0 with 32 tests (run-check 1bb87e26-0dda-4182-bf86-144a6cec83f2). Also added vitest.config.ts excluding .verification-evidence/** and .scratch/** from test discovery because vitest picked up the QA probe harness as a suite. Evidence: F:/MyWork/tkitchen/.verification-evidence/eng-02-repair-evidence.md. Awaiting qa-02 re-review.

## Independent re-review (qa-02)

verdict: pass. QA02-1 is resolved in the reviewed working tree: the unchanged independent harness passes 16/16, including compact imports/re-exports and CLI exit 1. Fresh npm run verify exits 0 with 32 tests in 6 files; run-check id 05c94bf7-4b2c-4d57-be10-1eee663de6b0. Evidence: F:/MyWork/tkitchen/.verification-evidence/qa-02-rereview.md, qa-02-rereview-probes.tap, qa-02-rereview-verify.log and qa-02-rereview-manifest.json. Pinned HEAD remains 8308f71146fba6d5dc532e1c309e1c4bd632e432 with implementation untracked, so the verdict covers the hashed working-tree artifact rather than committed implementation. No source edits made by QA; no further QA02-1 repair remains.
