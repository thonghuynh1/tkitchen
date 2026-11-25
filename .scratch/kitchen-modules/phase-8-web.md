# Phase 8: Web skeleton with shadcn

[Overview](overview.md)

## Goal

`src/web/` builds a React page with shadcn/ui, and the seams keep browser code away from Node.

## Changes

- devDependencies: `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `tailwindcss`, `@tailwindcss/vite`, plus what `shadcn init` adds (`class-variance-authority`, `clsx`, `tailwind-merge`, Radix packages per component).
- `index.html`, `vite.config.ts`, `src/web/main.tsx`, `src/web/app.tsx` (new): one page showing the three columns Todo / Doing / Done (D5), empty, built from shadcn `Card`.
- `components.json` (shadcn config) pointing components at `src/web/components/ui`, and `src/web/lib/utils.ts` for `cn`.
- `tsconfig.json`: `jsx` and DOM lib for `src/web` only, through a `tsconfig.web.json` if the Node config would otherwise gain DOM types.
- `.dependency-cruiser.cjs`, with the trailer since it changes seams:
  - `web-never-imports-node`: `src/web` and any module `web.ts` reach no Node built-in and no module `index.ts` that reaches one.
  - `radix-only-in-components-ui`: `@radix-ui/*` is imported only from `src/web/components/ui`.
- `.oxlintrc.json`: an override for `src/web/components/ui/**` (generated shadcn code) recorded in `docs/lint-opt-outs.md`, with the trailer. Our own components outside it follow the full rule set.
- `package.json`: `build:web`; `verify` runs it.

## Data structures

- `Column = "todo" | "doing" | "done"`, in `src/modules/cards/index.ts` when ticket 01 creates that module; until then a local literal in `app.tsx`.

## Verification

Static: `npm run verify` exit 0, including `build:web`. A fixture import of `node:fs` from `src/web` fails `web-never-imports-node`.

Runtime: `vite preview` serves the page; `control-ui` (Playwright MCP) opens it and finds the three column headings by role. Screenshot kept under `.verification-evidence/`.
