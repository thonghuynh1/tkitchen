# Kitchen modules: restructure tkitchen and grow the waiter board inside it

## Context

The waiter board (`.scratch/waiter-board/map.md`) was going to be a new repo (D6). The user decided on 2026-11-25 to build it inside tkitchen instead (D11) and to restructure tkitchen on mattpocock/cookout's patterns: vertical modules with a public entry, private internals and private tests, enforced by structure lint (D9: patterns only, cookout has no license, so no code is copied).

tkitchen today is four layers (`src/domain`, `src/application`, `src/infrastructure`, `src/cli`; `docs/MODULES.md`). A regex script (`scripts/check-module-structure.mjs`) checks that imports point inward, that clock and random calls appear only in `src/infrastructure/env.ts`, and that no file exceeds 800 lines. All ports live in one file, `src/application/ports.ts`. Baseline on 2026-11-25: `npm run verify` green, 200 sim seeds, 0 violations.

Why now: the board adds an HTTP server, a browser UI and a second domain. Layers sliced by technical role would put board and kitchen code side by side in every layer. Vertical modules keep each feature in one folder with one public surface.

## Scope

Included:
- Move every `src/` file into `src/modules/<module>/`, split `ports.ts` so each module owns its contracts, and point tests at module entries.
- Replace the regex import checks with dependency-cruiser seams; keep the clock/random rule and the size budget.
- A lint ratchet, a lint config guard, and a few generic lint rules rewritten in our words.
- Move the kitchen out of `src/` into top-level `modules/` and `cli/` (phase 8, option C), so `src/` holds only the web app.
- A web skeleton: Vite + React + Tailwind + shadcn/ui under `src/`, served by a new `tkitchen board` verb with a health route.
- Docs: `docs/MODULES.md`, `AGENTS.md`, `CONTEXT.md`, a first `docs/adr/`.

Excluded:
- Board features (sign-in, cards, chat, `@waiter`). Those stay as waiter-board tickets 01 to 03 and land as modules on this skeleton.
- Any change to what tkitchen does. Phases 1 to 7 preserve behavior.
- cookout's UI lint rules (D10), its Effect usage, its merge-ticket flow.

## Constraints

- Plain TypeScript, Node ≥ 22.19, oxlint with the `tsrs` type-aware backend (`docs/MODULES.md` Lint). No Effect.
- The sim suite (`tests/sim`) and the contract suites (`tests/contract`) must keep passing unchanged in meaning. They import ports, round, serve, export, git, store today.
- `deploy/windows/install-task.ps1:10` and `.verification-skills/verify-tkitchen/scripts/vt.mjs:9` hardcode `src/cli/tkitchen.ts`. Keep that path, or move it and update both in the same phase.
- No cookout code is copied. Rules are rewritten from the prose descriptions in this plan.

## Alternatives

| Shape | For | Against | Verdict |
|---|---|---|---|
| Keep the four layers, add `src/board/` beside them | Smallest diff | Two structures in one repo; the next agent copies whichever it opened | ✗ |
| Workspace packages (`packages/kitchen`, `packages/board`) | Hard boundary | Workspace tooling, two package.jsons, two builds for one tool on one host | ✗ |
| **Vertical modules under `src/modules/`, a pure core plus `lib/adapters/` per module** | One rule for kitchen and board; tkitchen's inward rule survives inside each module | A one-time move of about 20 files | **Chosen** |

The chosen shape keeps tkitchen's best property: domain logic is pure and testable in the sim. It encodes that inside each module instead of across the repo. Only `lib/adapters/` and `cli` may touch Node built-ins, the file system or processes.

## Target layout

Revised 2026-11-26 (option C): `src/` is the web app and the modules sit in a top-level `modules/` folder, matching ts-template's root-level program. Phase 8 makes that move.

```
modules/
├── platform/   Clock, Scheduler, Random, Ids, machineName, kitchenHome   (was infrastructure/env.ts + ports)
├── triggers/   Trigger, Thread, Disposition, the SQLite kitchen store     (was domain/trigger, domain/disposition, infrastructure/sqlite/store.ts)
├── branches/   watched branches and Base resolution                       (was domain/branch, domain/base)
├── notices/    Notice and the notices/history read                         (was domain/notice, application/notices.ts)
├── rounds/     Round and serve loop                                       (was application/round.ts, application/serve.ts)
├── export/     export lines and the read-only export store               (was application/export.ts, infrastructure/sqlite/export-store.ts)
├── git/        GitRepo contract and the git runner                        (was infrastructure/git)
├── forge/      Forge contract, NoForge, GitHub forge                      (was infrastructure/forges.ts, infrastructure/github)
├── config/     Config contract and the config file                        (was infrastructure/config-file.ts)
├── lock/       Lock contract and the lock file                            (was infrastructure/lock-file.ts)
└── <module>/
│       ├── index.ts        pure entry: contracts and pure operations; any module may import it
│       ├── adapters.ts     Node entry: the implementations; only cli/, the root index.ts, other adapters and tests import it
│       ├── web.ts          browser-safe entry, only when the module has one
│       ├── lib/            pure internals; lib/contract.ts holds the module's contracts
│       ├── lib/adapters/   the only internals that touch node:*, fs, processes, sockets
│       └── tests/          private unit tests, importing ../index.ts only
src/                the React web app; shadcn components in src/components/ui
cli/tkitchen.ts     composition root (path recorded in the installer and verify-tkitchen)
index.ts            package entry, re-exports module entries only
tests/              cross-cutting suites: cli, sim, contract, quality, deploy; module entries only
```

Board modules arrive later, from waiter-board tickets: `identities` (GitHub sign-in), `cards` (board, columns, members, invites), `chat` (threads, messages, mentions), `live` (SSE), `waiter` (`@waiter` → one Trigger, the reply).

## Applicable skills

- `how` over each module before moving it; `architect` before phase 2 (the ports split crosses every boundary).
- `typescript-best-practices` for every edit.
- `tdd` for each lint rule: the fixture that fails first, then the rule.
- `control-cli` with `.verification-skills/verify-tkitchen` for the CLI journeys; `control-ui` for the browser skeleton in phase 9.
- `interrogate` on the module map before phase 1 starts.
- `unslop` on every doc and commit message.

## Phases

1. [Move files into modules](phase-1-move.md)
2. [Each module owns its contracts](phase-2-contracts.md)
3. [Tests through module entries](phase-3-tests.md)
4. [Module seams in dependency-cruiser](phase-4-seams.md)
5. [Lint ratchet](phase-5-ratchet.md)
6. [Lint config guard](phase-6-guard.md)
7. [Generic lint rules and docs](phase-7-rules-docs.md)
8. [Move the kitchen out of src](phase-8-move-out-of-src.md)
9. [Web skeleton with shadcn](phase-9-web.md)
10. [Board verb and health route](phase-10-board-verb.md)

## Verification

Project-level, after every phase:
- `npm run verify` (lint → typecheck → structure → tests → sim), exit 0. From phase 4 it includes `npm run seams`; from phase 5, `npm run lint` is the ratchet.
- The verify-tkitchen journeys (`.verification-skills/verify-tkitchen/SKILL.md`), run on the real CLI.
- Phases 1 to 3 are moves. The sim line must read `violations=0` with the same seed count as the baseline.

At plan completion: all of the above, plus the phase 9 and 10 browser check through `control-ui`.

## Implementation guidance

- Run the `how` skill over each subsystem before you change it.
- Run `interrogate` on the module map (Target layout above) before phase 1, and on the ports split before phase 2.
- Run `unslop` over every prose surface: docs, ADRs, commit messages.
- Build the lever. Phase 1 is a script that moves files and rewrites relative imports from one path map. Rerun it from a clean tree, not by hand.
- Each phase is one commit that leaves `npm run verify` green. Phases 1 to 3 change no behavior; a red sim means a move went wrong, not that the sim needs an edit.
