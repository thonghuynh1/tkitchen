# ADR 0003: src is the web app; modules and cli sit at the root

Status: accepted, 2026-11-26. Amends the layout in ADR 0001.

ADR 0001 put the vertical modules under `src/modules/`. The waiter board then needed a web app, and the phase 9 plan put it at `src/web/`, nested inside the Node program's tree. The user chose instead to match ts-template, where the program sits at the repository root and no `src/` wraps it: "src will be the web, modules will be top folder" (kitchen-modules phase 8, option C).

So `src/modules/<module>/` moved to `modules/<module>/`, `src/cli/tkitchen.ts` to `cli/tkitchen.ts`, and `src/index.ts` to the root `index.ts`. `src/` now holds only the board's web app, in the shape Vite and shadcn generate (`src/main.tsx`, `src/components/ui/`). The module rules from ADR 0001 are unchanged; every path-keyed check (seams, structure, the lint ratchet baseline, the `src/**` lint override) was repointed in the same commit, and the two hardcoded CLI paths (`deploy/windows/install-task.ps1`, verify-tkitchen's `vt.mjs`) moved with the file.

Rejected: web under `src/web/` (forces browser exceptions into checks written for the Node program), and a full ts-template copy with `app/` and `lint/` roots (tkitchen's cross-cutting suites in `tests/` and its rules in `scripts/oxlint/` have no slot in that shape, and the rename would buy nothing beyond appearance).
