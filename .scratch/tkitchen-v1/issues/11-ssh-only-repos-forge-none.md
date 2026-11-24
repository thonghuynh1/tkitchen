---
repo: F:/MyWork/tkitchen
status: closed
type: AFK
covers: [D-007 amendment (user, 2026-11-24, option A)]
---

## Parent

`.scratch/tkitchen-v1/PRD.md`, amends D-007 in `.scratch/tkitchen-v1/ledger.md`.

## Why

The live run on 2026-11-24 found that `gh` on the home machine is signed in as an account that cannot see the private `thonghuynh1/*` repos. Git reaches them over SSH, but every Round fails at `gh pr list`, so those repos never get notices. SSH exposes only `refs/pull/N/head` (no base, no head name, no state), so it cannot replace the PR rung. The user chose option A: let a repo opt out of the forge instead of changing the `gh` sign-in.

## What to build

A repo entry may set `"forge": "none"`. For that repo the kitchen never runs `gh`; bases come from the config `bases` and the reflog only. `"github"` stays the default and keeps D-007 unchanged. Any other value is still a config error (exit 2, naming `repos[i].forge`).

## Acceptance criteria

- [x] With `"forge": "none"` and a `gh` that fails, `round` exits 0, records the Round, and `lastError` stays null.
- [x] With `"forge": "none"`, a branch you created locally gets its base from the reflog (evidence `reflog`), and an open PR for that repo is ignored.
- [x] `"forge": "gitlab"` exits 2 naming `repos[0].forge`.
- [x] Repos without `forge`, or with `"github"`, behave exactly as before (existing tests unchanged).
- [x] README documents `"none"` and what it gives up (no PR evidence; teammate branches need `bases`).
- [x] Live: tstack over SSH with `"forge": "none"` completes a Round on the home machine.

## Evidence (2026-11-24, uncommitted)

- Code: `src/infrastructure/forges.ts` (new: `NoForge`, `ForgeByKind`, `FORGE_KINDS`), `config-file.ts` accepts `github`/`none`, `tkitchen.ts` wires `ForgeByKind`. README updated. Ledger: D-007 amended.
- Tests: `tests/cli/forge-none.test.ts` 3/3. The PR test runs the same world with `"forge": "github"` as a control (base `main`, evidence `pr`) and with `"none"` (base `C`, evidence `reflog`).
- `npm run verify` exit 0: 20 modules, 112/112 tests, sim 21/21, 200 seeds, 0 violations. Log: `.verification-evidence/indicate-v1/issue11/verify.log`.
- Live, home machine: tstack over SSH with `"forge": "none"`. Two Rounds, both exit 0 with empty stderr; `lastError` null; 8 needs_base and 1 behind (reflog) notice; local branches and worktree unchanged. Each Round took 85-89 s for 42 heads (see the slice-1 journal on pairwise ancestry cost).

Accepted by the user on 2026-11-24.
