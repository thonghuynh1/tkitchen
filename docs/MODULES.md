# Modules

tkitchen's code lives in vertical modules under `modules/<module>/`. Each module owns one part of the kitchen: its contracts, its pure logic, its Node code and its unit tests. The waiter board grows here too, as more modules. `src/` is reserved for the board's web app. Why this shape: [ADR 0001](adr/0001-vertical-modules.md) and [ADR 0003](adr/0003-src-is-the-web-app.md).

## Layout

```
modules/<module>/
├── index.ts        pure entry: contracts and pure operations; any code may import it
├── adapters.ts     Node entry: the implementations of the contracts
├── lib/            pure internals; lib/contract.ts holds the module's contracts
├── lib/adapters/   the only internals that touch node:*, the file system, processes or the clock
└── tests/          the module's unit tests
modules/cli/        the composition root as a module: lib/parse.ts reads the words,
                    lib/adapters/run.ts wires adapters to contracts, lib/adapters/main.ts runs it
index.ts            package entry: re-exports module entries only
src/                the waiter board web app (Vite entry index.html at the root; src/main.tsx)
tests/              cross-module suites: cli, sim, contract, quality, deploy
```

Modules today: platform (Clock, Scheduler, Random, Ids, machine name, kitchen home), triggers (Trigger, Thread, Disposition, the kitchen store), branches (watched branches, Base resolution), notices, rounds (Round, serve loop), export, git, forge, config, lock, board-http (the board's HTTP server on `node:http`: the built page plus `/v1/health`), cli (the words on the command line and the wiring that runs them).

## Rules

- **Entries only.** Code outside a module reaches it through `index.ts` or `adapters.ts`, never through `lib/` or `tests/`. A module's own tests use its entries too.
- **Pure lib.** A module's `lib/` outside `lib/adapters/` imports no Node built-in except `node:crypto` (deterministic hashing), and never imports `lib/adapters/` or any `adapters.ts`. It reaches the outside world through contracts that the cli module fills with adapters. This keeps the logic runnable in the sim.
- **Pure index.** `index.ts` exports nothing from `lib/adapters/`. Node code goes behind `adapters.ts`, so importing a module's contracts never loads `node:sqlite` or a child process.
- **No clock or randomness outside adapters.** Outside `lib/adapters/`, code does not call `Date.now()`, `new Date()` with no arguments, `setTimeout`, `setInterval`, `Math.random()` or `randomUUID()`; it uses the Clock, Scheduler, Random and Ids contracts from platform.
- **800 lines per file** under `modules/`. Split an over-budget file along its seams.
- **No cycles, no undeclared or unresolvable imports.**
- **Browser code stays out of Node.** Files under `src/` and any module `web.ts` import no Node built-in. Web code reaches a module only through its `web.ts`, never its `index.ts` or `adapters.ts`. `@radix-ui/*` is imported only from `src/components/ui/` (the shadcn components).

## Checks

`npm run verify` runs all of them, in this order.

| Check                | Command                        | Enforces                                                                                                                                                                                                       |
| -------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format               | `npm run format:check`         | `oxfmt --check .` with `.oxfmtrc.json` (width 120, 2 spaces, no import sorting; `.scratch`, the evidence folder, `package-lock.json` and `lint-baseline.json` are ignored). `npm run format` rewrites in place |
| Lint ratchet         | `npm run lint`                 | oxlint over the repo; no file may gain violations of any rule beyond `lint-baseline.json`                                                                                                                      |
| Lint config guard    | `npm run lint:guard`           | no loosening of the checks without the user's `Lint-approved-by:` trailer                                                                                                                                      |
| Types                | `npm run typecheck`            | `tsgo --noEmit` for the Node program and, with `tsconfig.web.json`, for `src/`                                                                                                                                 |
| Web build            | `npm run build:web`            | `vite build` into `dist/web`                                                                                                                                                                                   |
| Seams                | `npm run seams`                | dependency-cruiser, `.dependency-cruiser.cjs`: the entries, pure lib, pure index, cycle and import rules, one named rule each                                                                                  |
| Environment and size | `npm run verify:structure`     | `scripts/check-module-structure.mjs`: the clock rule and the 800-line budget                                                                                                                                   |
| Tests                | `npm test`, `npm run test:sim` | unit, contract, CLI and quality suites; the Round simulation                                                                                                                                                   |

Each rule has a failing fixture in `tests/quality/`: `seams.test.ts`, `structure.test.ts`, `lint.test.ts`, `ratchet.test.ts`, `guard.test.ts`.

### Lint ratchet

`scripts/lint-ratchet.ts` counts oxlint diagnostics per file and rule and compares them with `lint-baseline.json`. A count above the baseline fails, printing each diagnostic in that bucket as `file:line rule message`. A count below it passes with a note to tighten the baseline. `npm run lint:baseline` rewrites the baseline from a whole-repo run. The ratchet also reads the baseline and `.oxlintrc.json` at the merge base with `origin/main` and refuses a raised count for a rule that was already on there, so a new rule may start with existing violations, and after that the count only goes down. A file that git sees as renamed since the merge base keeps the baseline of its old path, so a pure move is not a raise; a raise at the new path still refuses.

### Lint config guard

`scripts/lint-config-guard.ts` reads every commit since the merge base, plus the working tree, and flags changes that loosen the checks: a rule lowered, removed or newly off, changed rule options, an override that turns a rule off for new files, an added ignore pattern, a removed plugin, any change to `.dependency-cruiser.cjs`, a new entry in `docs/lint-opt-outs.md`, an edit to an existing checker script, and a changed check script in `package.json`. A flagged change passes only when its commit carries `Lint-approved-by: <name>`, written after the user approved that change. Every rule that is off or loosened today is listed in `docs/lint-opt-outs.md` with its reason.

### Design rules

`scripts/oxlint/design-rules.js` holds four rules, written for tkitchen from one-line descriptions ([ADR 0002](adr/0002-borrow-cookout-patterns-not-code.md)):

- `design/context-terms`: a declared name may not use a word that a `CONTEXT.md` term lists under `_Avoid_`; the message names the term to use. It reads `CONTEXT.md` itself, so a new `_Avoid_` entry is enforced at once.
- `design/no-unsafe-as`: no `as` cast, except `as const` and a cast to a type parameter in scope. Narrow with a type guard instead.
- `design/no-pass-through`: no file whose only content re-exports one other file. Module `index.ts` and `adapters.ts` are exempt.
- `design/branded-ids`: an exported `*Id` type alias, or a parameter named `id` or `*Id`, may not be a bare `string` or `number`.

All four apply to every file, tests included. Their violations on 2026-11-26 sit in `lint-baseline.json`.

## Adding a module

Create `modules/<name>/` with `lib/contract.ts`, `lib/`, `index.ts`, and `adapters.ts` plus `lib/adapters/` if it needs Node. Export it from the root `index.ts`. Wire its adapters in `modules/cli/lib/adapters/run.ts`. Put its unit tests in its own `tests/`. Add a term to `CONTEXT.md` when it names a new concept.

## Lint backend

`npm run lint` runs oxlint with type-aware rules (`typeAware: true` in `.oxlintrc.json`). The type-aware backend is the `tsrs` package (typescript-go based, `0.25.0-ts7.1.0-beta`, copied from tstack at `bfa26c76`): with `typeAware` on and no backend installed, oxlint 1.94 fails with `Failed to find type-aware linter executable. You may need to add the tsrs or oxlint-tsgolint package to your project?`, and tstack's `package.json` carries both `oxlint ^1.94.0` and that exact `tsrs` version while its `node_modules` contains no `oxlint-tsgolint` package. tkitchen copies that arrangement, so `tsrs` is a devDependency alongside `oxlint`. The floating-promise fixture in `tests/quality/lint.test.ts` proves the type-aware rules are active, because that rule cannot fire without type information.
