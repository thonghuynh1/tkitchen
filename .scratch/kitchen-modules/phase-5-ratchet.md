# Phase 5: Lint ratchet

[Overview](overview.md)

## Goal

A new strict lint rule can be turned on with existing violations recorded, and no file may gain violations of any rule.

## Changes

- `scripts/lint-ratchet.ts` (new, our own). Algorithm:
  1. Run oxlint with JSON output over the repo.
  2. Count diagnostics per file and per rule.
  3. Compare with `lint-baseline.json`. Fail when any count goes above its baseline, printing `file:line rule message` for each new violation. A count that drops is fine and is reported as `tighten the baseline`.
  4. `--write` regenerates the baseline from a whole-repo run, and only from a whole-repo run.
  5. Compare the working baseline with the baseline at the merge base. Refuse a raised count for a rule that was already enabled there. A rule enabled by this change may start with any count.
- `lint-baseline.json` (new). It starts empty, since tkitchen lints clean today.
- `package.json`: `lint` runs the ratchet; `lint:baseline` runs `--write`.
- `tests/quality/ratchet.test.ts` (new): the counting and comparison run as a pure function over fixture reports. Cases: an unchanged count passes, an added violation fails, a dropped violation passes with a note, a new rule with existing violations passes once.

## Data structures

- `Baseline = Readonly<Record<FilePath, Readonly<Record<RuleName, number>>>>`.

## Verification

Static: `npm run verify` exit 0; `ratchet.test.ts` cases red first, then green.

Runtime: add a floating promise to a scratch copy of a `src` file. `npm run lint` fails naming it. Revert it, and `npm run lint` passes.
