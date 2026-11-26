# Phase 9: Web skeleton with shadcn

[Overview](overview.md)

## Goal

`src/` builds a React page with shadcn/ui, and the seams keep browser code away from Node.

## Changes

- devDependencies: `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `tailwindcss`, `@tailwindcss/vite`, plus what `shadcn init` adds (`class-variance-authority`, `clsx`, `tailwind-merge`, Radix packages per component).
- `index.html`, `vite.config.ts`, `src/main.tsx`, `src/app.tsx` (new): one page showing the three columns Todo / Doing / Done (D5), empty, built from shadcn `Card`.
- `components.json` (shadcn config) pointing components at `src/components/ui`, and `src/lib/utils.ts` for `cn`.
- `tsconfig.json`: `jsx` and DOM lib for `src/` only, through a `tsconfig.web.json` if the Node config would otherwise gain DOM types.
- `.dependency-cruiser.cjs`, with the trailer since it changes seams:
  - `web-never-imports-node`: `src` and any module `web.ts` reach no Node built-in and no module `index.ts` that reaches one.
  - `radix-only-in-components-ui`: `@radix-ui/*` is imported only from `src/components/ui`.
- `.oxlintrc.json`: an override for `src/components/ui/**` (generated shadcn code) recorded in `docs/lint-opt-outs.md`, with the trailer. Our own components outside it follow the full rule set.
- `package.json`: `build:web`; `verify` runs it.

## Data structures

- `Column = "todo" | "doing" | "done"`, in `modules/cards/index.ts` when ticket 01 creates that module; until then a local literal in `app.tsx`.

## Progress

Done 2026-11-26. Two deviations, both measured rather than assumed. The shadcn CLI (latest) could not resolve the `@/` alias in this repo shape and wrote the Card under a literal `@/` folder with a broken `cn` import; the file was moved to `src/components/ui/card.tsx`, its import pointed at `@/lib/utils`, and `utils.ts` plus the Tailwind v4 theme variables in `src/index.css` were written by hand in the shadcn shape, so `components.json` stays valid for future CLI adds. And the generated Card needed a far smaller lint override than planned: it passes every rule, the design rules included, except `typescript/no-unsafe-assignment` and `no-unsafe-call`, which fire only because the type-aware lint backend loads the Node tsconfig and reads `@/` imports as error-typed. The override turns off exactly those two rules for `src/components/ui/**` and `docs/lint-opt-outs.md` says when to remove it. A third rule joined the two planned seams rules: `web-reaches-modules-through-web-entry-only`, since dependency-cruiser cannot ask whether an `index.ts` transitively reaches Node, web code may reach a module only through `web.ts`.

## Verification

Static: `npm run verify` exit 0, including `build:web`. A fixture import of `node:fs` from `src` fails `web-never-imports-node`.

Runtime: `vite preview` serves the page; `control-ui` (Playwright MCP) opens it and finds the three column headings by role. Screenshot kept under `.verification-evidence/`.
