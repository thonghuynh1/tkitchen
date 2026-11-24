# Slice 1 feedback

Report: [Slice 1 verification](verification-slice-1.md) · Plan: [PRD](PRD.md) (no wayfinder map; tickets are issue files under `issues/`)

> Fix sessions change product code and tests only. Set `Status:` to exactly `fixed` or `ticketed`; never write **Verified**. A fix that needs a change to a formal model, its property or coverage hashes, a test's asserted behavior, a probe, an acceptance criterion, the contract, or the ledger goes back to indicate as a decision item instead of being made.

## FB-1 — A deep chain of dead lock-recovery tickets blocks startup
- Status: verified
- Reopens: 0
- Source: code-review
- Finding: Spec review: `src/infrastructure/lock-file.ts:207-215` names each nested recovery ticket by appending `.recover-<pid>` to the previous ticket's name. At 18 levels the path passes the Windows limit, and `acquire` throws `ENOENT` instead of returning `acquired` or `held`. Issue 07 says "Stale lock is taken over … a crash leaves the kitchen" able to start. First recorded as a P2 in `.verification-evidence/qa-07-repair4-rereview/report.md`.
- Expected: however many interrupted recovery attempts are left on disk (dead-owner or ownerless tickets, at any nesting depth), the next `acquire` returns `acquired` (or `held` when a live owner exists) and never throws on filename length. After a successful acquire only `kitchen.lock` remains.
- Re-verify probes: `node .scratch/tkitchen-v1/evidence/slice-1-probes/ticket-chain.mjs` from the repo root. It must report `"result": "acquired"` for every scenario, both `first` and `second`, including depth 18. Today it reports depth 5 `acquired` and depth 18 `threw` twice (`ticket-chain-at-c8928eb.log` alongside).
- Must not break: `npx vitest run tests/infrastructure/lock-file.test.ts tests/cli/serve-lock.test.ts`; `npx vitest run --config vitest.sim.config.ts tests/sim/serve.sim.ts`; `bash .verification-skills/verify-tkitchen/scripts/journeys/serve-and-lock.sh` (9/9 PASS); `npm run verify`.
- Proof: the depth-18 scenario of `ticket-chain.mjs`: `threw ENOENT` at `c8928eb`, `acquired` after the fix.
- Scenario: Serve and single-instance lock (crash recovery)
- Worth fixing: Jev ticket-later 0.61 (low confidence; fix-now 0.07, ticket-later 0.74, accept-residual 0.19); user: fix now, 2026-11-24 (fix allowed in the indicate session)
- Triage: implement now: recovery tickets get a fixed-length name (`kitchen.lock.recover-<digest of ticket name and judged owner>`) so nesting no longer grows the path, and a successful acquire clears any dead ticket left on disk, including old nested names, through the same identity-checked recovery.
- Fix: uncommitted. `src/infrastructure/lock-file.ts` (+28/-3): recovery ticket = `kitchen.lock.recover-<16-hex sha256 of ticket name + judged owner>`, and `acquire` clears dead `kitchen.lock.recover-*` / `kitchen.lock.takeover.recover-*` tickets after success via `clearDeadTicket`. Also adds the regression test `tests/infrastructure/lock-file.test.ts` → `acquires through any depth of dead recovery tickets and keeps live ones`. Proof before: `threw ENOENT` (`ticket-chain-at-c8928eb.log`). Proof after: depth 5 `acquired`, depth 30 (16 written, path limit) `acquired` first try, only `kitchen.lock` left (`.verification-evidence/indicate-v1/fb1/ticket-chain-after.log`). Regression test fails without the fix (ENOENT, `regression-before.log`) and passes with it. Must not break: lock-file + serve-lock 17/17 pass (before the new test); serve.sim 4/4 pass; serve-and-lock journey 9/9 PASS (`20261124-fb1-serve-lock`); `npm run verify` exit 0 (lint, typecheck, structure, 108/108, sim 21/21, 200 seeds 0 violations) → `fb1/verify-after.log`.
- Verified: re-verify 2026-11-24, verification report § Re-verify. Proof discriminates: pre-fix (src stashed) ticket-chain `acquired, threw, threw` and regression test exit 1; post-fix `acquired, acquired` and exit 0. Must not break: 28/28 unit, serve.sim 4/4, serve-and-lock journey 9/9 (`20261124-rv-serve-lock`), `npm run verify` exit 0. Evidence: `.verification-evidence/indicate-v1/reverify/`.## FB-2 — Duplicated pid parsing and identity reading in the lock
- Status: verified
- Reopens: 0
- Source: code-review
- Finding: Standards (baseline smell, Duplicated Code): `src/infrastructure/lock-file.ts:35-69` `readPidAt`/`readPidFromRaw` repeat the JSON pid parse; `:128-160` `readIdentityAt`/`readTicketSnapshotAt` repeat read, stat, hash, and key.
- Said: "yeah 1 should be fixed"
- Expected: the lock has one JSON pid parser and one file-snapshot reader (pid plus identity key); lock and ticket reads differ only in how the pid is decoded. Behaviour unchanged.
- Re-verify probes: `bash .scratch/tkitchen-v1/evidence/slice-1-probes/fb2-single-parsers.sh` → `identity-hash-sites=1 json-pid-sites=1` and `PASS` (today 2 and 2, `FAIL`).
- Must not break: `npx vitest run tests/infrastructure/lock-file.test.ts tests/cli/serve-lock.test.ts`; `npx vitest run --config vitest.sim.config.ts tests/sim/serve.sim.ts`; `node .scratch/tkitchen-v1/evidence/slice-1-probes/ticket-chain.mjs` (all `acquired`); serve-and-lock journey 9/9; `npm run verify`.
- Proof: `fb2-single-parsers.sh` fails before, passes after.
- Scenario: Serve and single-instance lock
- Worth fixing: skipped: user's own words "1 should be fixed"; user: fix now, 2026-11-24
- Triage: implement now: one `pidFromJson`, one `readSnapshotAt(path, decodePid)`.
- Fix: uncommitted. `src/infrastructure/lock-file.ts`: one `pidFromJson`, `ticketPid` (plain pid or JSON), `readRaw`, and one `readSnapshotAt(path, decodePid)` replace `readPidFromRaw`/`readIdentityAt`/`readTicketSnapshotAt`. Proof before: `identity-hash-sites=2 json-pid-sites=2 FAIL`; after: `1 1 PASS`. Must not break: lock-file + serve-lock + forge + pr-base 28/28; serve.sim pass; ticket-chain.mjs both `acquired`; serve-and-lock journey 9/9; `npm run verify` exit 0 (109/109, sim 21/21, 200 seeds 0 violations) → `.verification-evidence/indicate-v1/fb23/`.
- Verified: re-verify 2026-11-24. Probe pre-fix `2 2 FAIL`, post-fix `1 1 PASS`. Must not break as FB-1 (same runs), plus ticket-chain all `acquired`. Evidence: `.verification-evidence/indicate-v1/reverify/`.## FB-3 — gh runs through a shell on Windows: DEP0190 on every Round, gh can outlive its timeout
- Status: verified
- Reopens: 0
- Source: code-review
- Finding: Standards (seen while driving): `src/infrastructure/github/github-forge.ts:12` passes an args array with `shell: true` on win32. Node prints `DEP0190` on every `round`/serve Round, and the 20 s timeout kills only the shell.
- Said: "3 fix"
- Expected: `gh` is started without an args-plus-shell spawn, so no `DEP0190` is printed. On timeout the whole `gh` process tree is killed, and the Round fails with `PortError("timeout")`. PR results and the failure exit codes are unchanged.
- Re-verify probes: `bash .scratch/tkitchen-v1/evidence/slice-1-probes/fb3-no-dep0190.sh` → `pass=2 fail=0` (today `no DEP0190` fails); `npx vitest run tests/infrastructure/gh-timeout.test.ts` → passes: a fake gh that sleeps is rejected with kind `timeout` within 5 s, and its recorded pid is dead afterwards.
- Must not break: `npx vitest run tests/contract/forge.test.ts tests/cli/pr-base.test.ts`; pr-base journey 11/11; `npm run verify`.
- Proof: both probes fail before, pass after.
- Scenario: GitHub PR targets via gh
- Worth fixing: skipped: user's own words "3 fix"; user: fix now, 2026-11-24
- Triage: implement now: `createGhRunner({ timeoutMs })` like `createGitRunner`; on win32 run the fixed command line via `exec` (no args array), and kill the tree with `taskkill /T /F` on timeout.
- Fix: uncommitted. `src/infrastructure/github/github-forge.ts`: `createGhRunner({ timeoutMs })` (`GH_TIMEOUT_MS = 20000`). On win32 it runs the fixed command line through `exec` (no args array; arguments must match `[\w.,=-]+`); elsewhere it uses `execFile`. On timeout `taskkill /T /F` kills the tree and the call rejects `PortError("timeout")`. `tests/fixtures/fake-gh/fake-gh.mjs` gained `FAKE_GH_SLEEP_MS` and `FAKE_GH_PID_FILE`; new test `tests/infrastructure/gh-timeout.test.ts`. Proof before: DEP0190 probe `fail=1`; gh-timeout test failed (`createGhRunner is not a function`: API missing, a weak discriminator; the DEP0190 probe is the behavioral one). After: DEP0190 probe `pass=2 fail=0`; gh-timeout 1/1 (fake gh pid dead after timeout). Must not break: forge contract + pr-base pass (in the 28/28); pr-base journey 11/11; `npm run verify` exit 0 → `.verification-evidence/indicate-v1/fb23/`.
- Verified: re-verify 2026-11-24. DEP0190 probe pre-fix `pass=1 fail=1`, post-fix `pass=2 fail=0`; gh-timeout test pre-fix exit 1, post-fix exit 0. Must not break: forge contract + pr-base in 28/28, pr-base journey 11/11 (`20261124-rv-pr-base`), `npm run verify` exit 0. Evidence: `.verification-evidence/indicate-v1/reverify/`.

## FB-4 — a failing recovery-ticket sweep turns a successful acquire into an error

- Source: fix-diff review during re-verify (regressions only); the user chose "do small lock fix" on 2026-11-24.
- Contract: when the post-acquire sweep of dead recovery tickets throws (for example `readdir` EACCES), `acquire` still returns `acquired` and the lock names this process.
- Proof: `tests/infrastructure/lock-sweep-failure.test.ts` injects a failing `readdir`. Before the fix it fails with `EACCES: permission denied, scandir`; after the fix it passes.
- Must not break: lock-chain probe `ticket-chain.mjs` (all `acquired`), serve-and-lock journey 9/9, `npm run verify`.
- Status: fixed
- Fix: `src/infrastructure/lock-file.ts` `acquire` makes the sweep best-effort (`.catch(() => undefined)`). Proof before exit 1 and after exit 0; ticket-chain `acquired, acquired`; journey `20261124-sweep-serve-lock` 9/9; `npm run verify` exit 0 (115 tests, sim 21, 200 seeds, 0 violations). Logs: `.verification-evidence/indicate-v1/lock-sweep/`.
- Verified:

