# 0001: Vertical modules

Status: accepted, 2026-11-25 (user; waiter-board ledger D11). Landed in phases 1 to 7 of `.scratch/kitchen-modules/`.

## Context

tkitchen was four layers: domain, application, infrastructure and CLI. The waiter board, which is built inside tkitchen (D11), adds an HTTP server, a browser UI and a second domain. With layers, board code and kitchen code would sit side by side in every layer.

## Decision

Code lives in vertical modules under `src/modules/<module>/`. Each module has a pure entry (`index.ts`), a Node entry (`adapters.ts`) when it has Node code, pure internals in `lib/` with its contracts in `lib/contract.ts`, Node code only in `lib/adapters/`, and its own `tests/`. dependency-cruiser enforces the seams (`docs/MODULES.md`).

The layers' best property survives inside each module: logic outside `lib/adapters/` is pure, so the Round simulation runs it with fake contracts.

## Rejected

- **Keep the layers and add `src/board/` beside them.** Smallest diff, but two structures in one repo, and the next agent copies whichever one it opened.
- **Workspace packages (`packages/kitchen`, `packages/board`).** A hard boundary, but workspace tooling, two `package.json` files and two builds for one tool on one host.

## Consequences

- A module's internals can move freely; only its entries are its surface.
- `src/cli/tkitchen.ts` stays the composition root, and its path stays fixed because the Windows installer and verify-tkitchen call it.
- Importing a contract never loads Node code, because `index.ts` may not export adapters.
