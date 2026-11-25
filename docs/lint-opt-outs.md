# Lint opt-outs

Every rule that `.oxlintrc.json` turns off or loosens, and why. Adding an entry needs a commit with the trailer `Lint-approved-by: <name>`; `npm run lint:guard` checks it. Removing an entry, once the code behind it is fixed, needs no approval.

- `categories.correctness: off` (all files): rules are picked one by one in `rules`, so a new oxlint release cannot turn on unreviewed rules.
- `ignorePatterns: .scratch` (all files): planning notes and issues, not code.
- `scripts/**`: `eslint/complexity`, `typescript/no-unnecessary-type-assertion`, `typescript/no-non-null-assertion`, `typescript/no-unsafe-*` off: developer scripts read untyped JSON and git output and are run by hand, not shipped.
- `**/*.js`, `**/*.mjs`, `**/*.cjs`: `typescript/no-unsafe-*` off: plain JavaScript has no types, so every value would count as `any`.
- `**/fixtures/**`, `**/*.d.ts`: `eslint/no-magic-numbers` off: fixture data and declarations are literal by nature.
- `**/tests/**`, `**/*.test.*`, `**/*.sim.ts`: `eslint/max-lines`, `eslint/complexity`, `eslint/no-magic-numbers`, `typescript/no-non-null-assertion`, `typescript/only-throw-error`, `typescript/unbound-method`, `typescript/no-unsafe-*` off: tests build fake data with literals, assert on values they know are present, throw non-errors on purpose to test error paths, and read loosely typed results.
