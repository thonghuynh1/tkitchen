# Modules

In transition (2026-11-26): the files now live in vertical modules under `src/modules/<module>/`, with pure code in `lib/` and Node-touching code in `lib/adapters/`. The layer rules below are being rewritten for that layout; see `.scratch/kitchen-modules/overview.md`. Until phase 7 rewrites this page, `scripts/check-module-structure.mjs` enforces this: a module's `lib/` outside `lib/adapters/` may not import `lib/adapters/`, `src/cli/`, or a Node built-in other than `node:crypto`. The environment rule exempts every `lib/adapters/`.

tkitchen has four layers under `src/`. Dependencies point inward: a layer may import the layers inside it and must not import the layers outside it.

| Layer | Home | Owns |
|---|---|---|
| Domain | `src/domain/` | Pure branch, Trigger, Disposition, and Notice logic |
| Application | `src/application/` | Ports and the Round and Notices use cases |
| Infrastructure | `src/infrastructure/` | SQLite, git, config file, and the system environment |
| CLI | `src/cli/` | Argument parsing, composition of the other layers, and exit codes |

## Dependency rule

`src/domain/` stays pure and may import only `src/domain/`. `src/domain/` and `src/application/` must not import `src/infrastructure/` or `src/cli/`; the application talks to the outside world through the ports in `src/application/ports.ts`, and the CLI wires concrete infrastructure implementations to those ports. Infrastructure may import domain and application ports. The CLI may import every layer.

`scripts/check-module-structure.mjs` enforces this rule over `src/**/*.ts` and exits 1 on a violation. Its pure `inspect(files)` export takes a map of path to source text and returns the error strings, so tests exercise the rule without touching the file system.

## Environment rule

Outside `src/infrastructure/`, code must not call `Date.now()`, `new Date()` with no arguments, `setTimeout`, `setInterval`, `Math.random()`, or `randomUUID()`. Use the Clock, Scheduler, Random, and Ids ports from `src/application/ports.ts` instead; `src/infrastructure/env.ts` is their system implementation and the only home of those calls. The structure checker enforces this rule with the message `use the Clock/Scheduler/Random/Ids port`.

## Module budget

No file under `src/` may exceed 800 lines. The structure checker counts lines and fails a file at 801 lines; a file of exactly 800 lines passes. Split an over-budget module along its seams into a deeper module.

## Lint

`npm run lint` runs oxlint with type-aware rules (`typeAware: true` in `.oxlintrc.json`). The type-aware backend is the `tsrs` package (typescript-go based, `0.25.0-ts7.1.0-beta`, copied from tstack at `bfa26c76`): with `typeAware` on and no backend installed, oxlint 1.94 fails with `Failed to find type-aware linter executable. You may need to add the tsrs or oxlint-tsgolint package to your project?`, and tstack's `package.json` carries both `oxlint ^1.94.0` and that exact `tsrs` version while its `node_modules` contains no `oxlint-tsgolint` package. tkitchen copies that arrangement, so `tsrs` is a devDependency alongside `oxlint`. The floating-promise fixture in `tests/quality/lint.test.ts` proves the type-aware rules are active, because that rule cannot fire without type information.
