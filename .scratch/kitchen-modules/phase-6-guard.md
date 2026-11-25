# Phase 6: Lint config guard

[Overview](overview.md)

## Goal

An agent cannot make a check pass by loosening the checks. Loosening needs the user's approval, recorded in the commit.

## Changes

- `scripts/lint-config-guard.ts` (new, our own). Algorithm:
  1. Take the commit range from the merge base with `main` to `HEAD`, plus the working tree.
  2. In `.oxlintrc.json`, flag a rule removed or lowered (`error` → `warn` or `off`), changed options, an override added or widened, an `ignorePatterns` entry added, or a plugin removed. Flag any change it cannot classify as tighter.
  3. Flag any change to `.dependency-cruiser.cjs` and any entry added to `docs/lint-opt-outs.md`.
  4. A flagged file passes only when a non-merge commit touching it carries the trailer `Lint-approved-by: <name>`.
  5. Print each finding with its file and hunk.
- `docs/lint-opt-outs.md` (new): every rule that is off or loosened today (the `scripts/**`, `**/*.js` and tests overrides in `.oxlintrc.json`), each with one line of why.
- `package.json`: `lint:guard`; `verify` runs it.
- `tests/quality/guard.test.ts` (new): the classifier runs as a pure function over before/after config pairs. Cases: a rule lowered is flagged, a rule added passes, a widened override is flagged, the trailer clears a finding.

## Data structures

- `Finding = { file: string; kind: "lowered" | "removed" | "widened" | "ignored" | "unclassified" | "seams-changed" | "opt-out-added"; detail: string }`.

## Verification

Static: `npm run verify` exit 0; `guard.test.ts` red first, then green.

Runtime: on a scratch branch, turn `typescript/no-floating-promises` off and commit. `npm run lint:guard` fails naming it. Amend with the trailer, and it passes. Delete the branch.
