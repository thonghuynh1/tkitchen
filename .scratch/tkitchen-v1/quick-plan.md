# Plan: tkitchen v1 (git first)
Status: consumed (PRD.md, 2026-11-23)

Drafted with draft-plan from `plan.md` (the vault slice), `ledger.md` (paused grill, K1-K12) and the user's answers on 2026-11-22. `plan.md` stays the vault copy; this file is the build plan for vault Build order step 6 only.

## Intent

- **Goal:** when a branch's base moves on `origin`, every watched child branch gets a recorded **notice** saying whether it is now behind, by how many commits, so nobody has to remember the branch tree.
- **For:** the user on both machines (home, work laptop); every author's branches in the watched repos, because the tree is built from open PRs.
- **Success:** `main`→A, A→F, C→B, C→D. Push to C → within one round (≤15 min) `tkitchen notices` shows B and D as behind C, and nothing for A or F. A child that catches up drops off the list on the next round.
- **Non-goals (v1):** rebase, push, or any write to a repo; forge CI, review comments, tstack, the workspace, the judge, the watchdog; the effect table; the aiNho importer (aiNho repo); cross-machine routing.

## Assumptions

- A-001: Confirmed by the user 2026-11-22 (K11): work repos are on GitHub and v1 uses `gh` only; Azure DevOps later behind the same `Forge` seam.
- A-002: Confirmed by the user 2026-11-22: the resident process starts at **user sign-in** through a per-user scheduled task on both machines (git and `gh` need the user's credentials).
- A-003: The explicit base rung in v1 is a per-branch override in the machine config; reading aiNho Work Session branch bases waits until `work-session branch add` exists (plan "Open, tracked elsewhere").
- A-004: The machine id is `os.hostname()` (home `DESKTOP-LJB4PL8`).
- A-005: Confirmed by the user 2026-11-22: the work laptop allows that task. Node 22.22 is fine: tstack runs `.ts` with a plain `#!/usr/bin/env node` on `>=22.19.0` (GROUND-009).
- A-006: The watched repos are a handful (single digits to low tens) per machine; a round runs repos one after another.

## Decisions

- D-001: **One resident Node process, `tkitchen serve`**, that owns an in-process scheduler and runs a round per configured repo every 15 minutes (staggered, one at a time); a one-shot `tkitchen round [--repo <name>]` runs the same code for manual use and tests. Started at sign-in by a launch-only scheduled task, `deploy/windows/install-task.ps1`, the aiLau pattern. — rationale: later producers (forge poll, workspace, watchdog) become more loops in the same process and share one store writer; a task per producer would multiply processes and writers. — rejected: a scheduled task that runs `tkitchen round` every 15 min (simplest, but no home for later producers and a cold start per round); herdr or aiLau as host (aiLau needs Node 26, herdr is a UI). — evidence: GROUND-006, GROUND-008 — depends on: A-002
  - Settled by: choice (root; user leaned this way 2026-11-22, K4 was open)
  - Decided: `serve` is the only long-lived writer; single instance enforced with an exclusive lock file next to the store (holds the pid; a lock whose pid is dead is taken over). `round` while `serve` runs refuses with "already running"; there is no bypass (F-008).
  - Left to the implementer: log file location and rotation, jitter, graceful shutdown details.
- D-002: **Package shape copies tstack:** ESM TypeScript run directly by Node (built-in type stripping, no flag), `bin: { tkitchen: "src/cli/tkitchen.ts" }` with `#!/usr/bin/env node`, `node:sqlite` only, vitest, oxlint; `engines.node >=22.19.0` (same floor as tstack); library entry `src/index.ts` exports the store and round. — evidence: GROUND-005, GROUND-009 — depends on: none
  - Settled by: precedent (`F:/MyWork/tstack/package.json`)
  - Decided: no runtime dependencies besides Node built-ins.
  - Left to the implementer: tsconfig details, lint rules.
- D-003: **Per-machine config** `~/.tkitchen/config.json`: `{ repos: [{ name, path, remote?: "origin", forge?: "github", bases?: { "<branch>": "<base>" } }], roundMinutes?: 15 }`. Store at `~/.tkitchen/kitchen.db` unless `TKITCHEN_HOME` is set. — rationale: user answer 2026-11-22. — depends on: none
  - Settled by: choice (user accepted 2026-11-22)
  - Decided: config is read at each round, so editing it needs no restart.
  - Left to the implementer: validation messages.
- D-004: **Store schema v1** in one `node:sqlite` file, migrated by `PRAGMA user_version` (revised after verification F-007, F-009, F-010):
  - `event` (immutable): `id TEXT PK, seq INTEGER UNIQUE (insert order), source, threads JSON, actor, human INTEGER, addressed, at, text, channel, url, machine, meta JSON` — the plan's fields plus `seq` for export order. Insert is `INSERT OR IGNORE` on `id`.
  - `disposition`: one row per **(event_id, thread, consumer)**, columns `event_id, thread, consumer, filtered, outcome, outcome_event_id, rule_id, policy_version, handbacks JSON, at, meta JSON`. Per thread because one `base moved` event fans out to several children and each child gets its own outcome.
  - `repo_heads` (local, mutable cache): `repo, branch, oid, seen_at` — the last complete `ls-remote` snapshot.
  - `branch_state` (local, mutable, current truth for notices): `repo, branch, base, base_evidence, head_oid, base_oid, behind_by, status (up_to_date | behind | needs_base | ambiguous), since, last_event_id`. Rewritten each complete round for every watched branch; a branch that leaves the watched set is deleted. Events and dispositions stay the history; `branch_state` answers "what is open now", so a repeated head (force-push A→B→A→B, deduped by D-005) or a first-run scan needs no event.
  - No `effect` table (plan: arrives with the first real action).
  — evidence: plan "Store"; ledger A4 — depends on: none
  - Settled by: choice (the plan lists disposition fields but no key; adding `thread` to the key and a current-state table are new)
  - Decided: table names, keys, `seq`, migration mechanism, history vs current-state split.
  - Left to the implementer: indexes, column types beyond the above.
- D-005: **Event id recipe** for v1: `id = sha256("git-base\0" + repo + "\0" + base + "\0" + newHead)`, `source: "git"`, `human: false`, `actor: "git"`, `threads` = `git:<repo>:<child>` for every child, `meta: { base, oldHead, newHead }`. A re-poll of the same head is a duplicate; a new push is a new event. — evidence: plan "ID recipe" — depends on: D-004
  - Settled by: precedent (plan "ID recipe", ledger K12)
  - Decided: hash function and separator.
- D-006: **Base detection is automatic and kitchen-owned:** `src/domain/base/` (pure decision) plus git/gh evidence readers in `src/infrastructure/` (D-011) port the rung order from pi-selftools — explicit (config `bases`) → open PR target → creation reflog (named, ancestry-verified) → creation reflog-tip (exactly one candidate) → `needs_base`; never merge-base. pi-selftools and herdr keep their copies in v1; sharing is a later step (ledger K8). — rationale: the existing code is a saved-tool body bound to one org and PBI ids, not importable (GROUND-001). — evidence: GROUND-001, GROUND-003 — depends on: D-003, D-007
  - Settled by: choice (K8: own-and-share vs. each keeps a copy)
  - Decided: module, rung order, `needs_base` as an outcome, not an error.
  - Left to the implementer: candidate caps (pi-selftools uses 200), internal helpers.
- D-007: **Open PRs come from the forge through `gh`**, behind a small `Forge` interface: `listOpenPullRequests(repo) → [{ number, head, base, url, author }]`, implemented by `GitHubForge` with `gh pr list --state open --json number,headRefName,baseRefName,url,author --limit 200`. Called once per repo **every round** (see Decided). Children of branch C = open PRs with `base == C` ∪ watched branches whose other rungs resolve to C. — rationale: the tree is built downward from open PRs for every author (plan); reflog only knows local branches (GROUND-001); herdr already uses `gh` as its forge client (GROUND-003). — evidence: GROUND-001, GROUND-002, GROUND-003 — depends on: A-001
  - Settled by: choice (root: the only source of other authors' bases; a forge call inside "git first")
  - Decided: `Forge` seam, one call **every round** (not only when heads change, so retargeted or new PRs and config edits are seen: F-002), `gh` as the GitHub client. A `gh` failure marks the round **incomplete**: no snapshot is advanced and `branch_state` is not rewritten, so the next round retries (F-003). Conflicts keep pi-selftools/herdr behaviour: explicit vs PR mismatch → `ambiguous`, several PRs from one head → `ambiguous`, cycles rejected (F-005).
  - Left to the implementer: JSON parsing, pagination beyond 200.
- D-008: **The round**, per repo: `git ls-remote --heads <remote>` and the open-PR list (D-007) and the config. If heads differ from `repo_heads`: `git fetch <remote> --prune`. Then build the watched set (pushed, not merged into its base, not merged into another pushed branch), resolve each base (D-006) and the child index. For every base whose head moved and that has children, insert one `base moved` event (D-005) with a notice disposition per child (D-009). Recompute the stale check (`merge-base --is-ancestor base child`, `rev-list --count child..base`) for every child whose own head, base head, or resolved base changed since its `branch_state` row, so a child that catches up closes its notice (F-001). Rewrite `branch_state`, then `repo_heads`. Guards: 20 s timeout per git/gh call; any failure makes the round incomplete (nothing advanced, retried next round); no store transaction is open while git runs (collect first, write in one short transaction after). **First round** (empty `repo_heads`): no events, but `branch_state` is filled, so children that are already behind show up at install (F-010). Quiet round cost: one `ls-remote` + one `gh` call. — evidence: plan "Round", "Watched branches"; background item 8 — depends on: D-003, D-004, D-005, D-006, D-007, D-009
  - Settled by: choice (the plan's order and guards are precedent; checking on child moves, the every-round PR refresh, and the first-round fill are new)
  - Decided: order of steps, timeouts, transaction boundary, incomplete-round rule, first-round rule.
  - Left to the implementer: git exec wrapper, parsing.
- D-009: **Notice station** (`consumer: "notice"`, `rule_id: "notice.base-moved"`, `policy_version: 1`) writes one disposition per child thread of each `base moved` event, with `outcome` = `behind` (`meta.behindBy`) | `up_to_date`. Nothing is sent anywhere. `tkitchen notices` reads `branch_state` (D-004): every watched branch that is `behind`, `needs_base` (with a hint to add a config `bases` entry) or `ambiguous`, with its base, the evidence rung, and the event id that last moved it; `--history` lists events with their dispositions, `--json` for machines. No acknowledge verb: a notice closes when the child catches up or leaves the watched set. — evidence: plan "v1", "Rules for every station" — depends on: D-004
  - Settled by: choice (root: what the user sees; K10 for v1)
  - Decided: outcomes, open-notice rule, CLI shape.
  - Left to the implementer: table formatting.
- D-010: **Export for aiNho:** `tkitchen export --json [--after <cursor>]` streams NDJSON `header` (`schema: "tkitchen.export/1"`, `machine`, `reset`) → `event` lines in `seq` order → `end` (`cursor`, `events`). Cursor = `{ s: seq, id }`, opaque; a cursor whose `seq` is missing or whose `id` no longer matches sets `reset: true` and restarts from 0. Stated limit, as in tstack: a replaced store identical up to the cursor is not detected (harmless: aiNho keeps rows by `(machine, id)`, ADR 0007). Events only: dispositions and `branch_state` stay on the machine (plan "disposition … never crosses"). The aiNho importer is out of scope. — evidence: GROUND-004; plan "Store" — depends on: D-004
  - Settled by: choice (shape copies `tstack/src/cli/journal-export.ts`; one stream and the `(seq, id)` cursor are simpler than tstack's two-stream cursor: F-011)
  - Decided: schema name, line types, cursor, events-only.
  - Left to the implementer: stream error handling.

- D-011: **Layered DDD module structure, copied from tstack:** `src/domain` (pure: no I/O, imports only `src/domain`), `src/application` (use cases and ports), `src/infrastructure` (adapters: sqlite, git, gh, config file, lock, clock), `src/cli` (entry points). Enforced by `scripts/check-module-structure.mjs` (domain purity + 800-line module budget) in `npm run verify:structure`, and described in `docs/MODULES.md`. — rationale: user asked for DDD (2026-11-22); tstack already runs this exact shape with a checker, so it is a copy, not a new pattern. — evidence: GROUND-010 — depends on: D-002
  - Settled by: precedent (`F:/MyWork/tstack/src/{domain,application,infrastructure,cli}`, `scripts/check-module-structure.mjs`)
  - Decided: the layers, the dependency rule (cli → application → domain; infrastructure implements application ports; domain imports nothing outside domain), the checker. Base resolution splits in two: `domain/base` decides the base from gathered **evidence** (override, PR targets, creation reflog entry, candidate tips at creation) and `infrastructure/git` + `infrastructure/github` gather that evidence. Round orchestration lives in `application`, so the domain is testable without git.
  - Left to the implementer: file names inside each layer, whether ports are interfaces or function types.
  - Layout:
    ```text
    src/
    ├── domain/            pure
    │   ├── trigger/       Trigger (event), Thread, event id recipe (D-005)
    │   ├── disposition/   Disposition, outcomes, rule id + policy version
    │   ├── branch/        watched set, BranchTree (children by base), staleness
    │   ├── base/          resolveBase(evidence) → base | needs_base | ambiguous (D-006)
    │   └── notice/        notice station rules (D-009)
    ├── application/
    │   ├── ports.ts       EventStore, BranchStateStore, GitRepo, Forge, Config, Clock, Lock
    │   ├── round.ts       one repo's round (D-008)
    │   ├── serve.ts       scheduler loop (D-001)
    │   ├── notices.ts     open-notice query
    │   └── export.ts      tkitchen.export/1 stream (D-010)
    ├── infrastructure/
    │   ├── sqlite/        db, schema + migrations, stores (D-004)
    │   ├── git/           runner with timeout, ls-remote, fetch, reflog, ancestry
    │   ├── github/        GitHubForge via gh (D-007)
    │   ├── config-file.ts ~/.tkitchen/config.json (D-003)
    │   └── lock-file.ts   single instance, dead-pid takeover
    ├── cli/               tkitchen.ts router, serve, round, notices, export
    └── index.ts           library entry
    ```

- D-012: **Deterministic simulation testing (DST) is the main test layer**, copied from tstack's `tests/sim/` harness (GROUND-011) with one deliberate difference: tkitchen is new, so it takes tstack's rejected **approach A** (an injected environment port) from day one instead of tstack's global fakes. The real `application` round, serve loop, notice station, store and export run in one process against a simulated world; a seed decides every push, merge, PR change, fault and timer; oracles run after every step; a failure prints its seed and `SIM_SEED=<n>` replays it exactly. — rationale: user asked for DST as the test base (2026-11-22); D-011's ports make every I/O edge replaceable, so no global fakes are needed. — evidence: GROUND-010, GROUND-011 — depends on: D-011
  - Settled by: precedent (`F:/MyWork/tstack/.scratch/dst/overview.md`, `tests/sim/`, `vitest.sim.config.ts`) — except approach A instead of B, which is choice (recommended: cheap on a new codebase, and tstack's overview names A as the complete option)
  - Decided:
    - **Env port** in `application/ports.ts`: `Clock` (now), `Scheduler` (sleep/interval), `Random`, `Ids`. Production code never calls `Date`, `setTimeout`, `Math.random` or `crypto.randomUUID` directly; `verify:structure` rejects them outside `infrastructure/`.
    - **Simulated world** (`tests/sim/world/`): seeded RNG, virtual clock, trace with a hash (determinism fingerprint: same seed → same hash, checked every run).
    - **Doubles** (`tests/sim/doubles/`): `SimRemote`, an in-memory model of commits, branches, reflogs and ancestry implementing `GitRepo`; `SimForge` implementing `Forge` (open, close, retarget PRs; several PRs from one head; forks); every port call resolves when the scheduler says, so the round's `await` points interleave.
    - **Store:** real `node:sqlite` on a temp file (deterministic; same as tstack's file-backed journal). Real git and `gh` are forbidden inside a sim run.
    - **Actors** (`tests/sim/actors/`): developers who branch, push, force-push, merge, delete, open and retarget PRs; a human who edits config `bases` and runs `notices`/`export`.
    - **Faults** (`tests/sim/faults/`): `gh` failure and rate limit, git timeout, `fetch` failure after a changed `ls-remote`, crash and restart of `serve` between any two steps, a stale lock with a dead pid, a second `serve`.
    - **Oracles** (`tests/sim/oracles/`), safety: after every complete round, `branch_state` equals ground truth computed from `SimRemote` + `SimForge` (base, status, behind count); an incomplete round changes nothing; an event id is never inserted twice and a re-poll adds no rows; at most one writer holds the lock; no store transaction is open across a port call; concatenated exports contain every event exactly once in `seq` order, across resets. Progress: after the world goes quiet, notices match ground truth within one complete round.
    - **Runner** (`tests/sim/runner/`): seed loop, `SIM_SEED` replay, `SIM_SEEDS=<n>` batch, trace dump on failure, pinned seeds in `tests/sim/scenarios/` for every bug found.
    - **Adapter contract tests:** one shared contract suite runs against `SimRemote` and against the real git adapter on temp repos (and `SimForge` vs a recorded `gh` fixture), so the doubles cannot drift from reality.
    - `npm run test:sim` (`vitest.sim.config.ts`, `tests/sim/**/*.sim.ts`) runs a fixed seed batch in under 1 minute; `npm test` keeps pure domain and adapter tests.
  - Left to the implementer: shrinking (tstack has it; not v1), transition coverage reports, actor weights, batch size.
- D-013: **Lint rules copied from tstack's `.oxlintrc.json`** (GROUND-012): plugins `typescript`, `unicorn`, `oxc`, `import`; `typeAware: true`; `correctness` category off, then an explicit rule list:
  - Size and shape: `eslint/max-lines` 1000, `eslint/complexity` 20, `no-else-return`, `eqeqeq`, `no-eval`, `import/no-self-import`.
  - Promises (matters for the round's `await` points and DST): `typescript/no-floating-promises`, `no-misused-promises`, `use-unknown-in-catch-callback-variable`, `only-throw-error`, `eslint/no-promise-executor-return`.
  - Type safety: `switch-exhaustiveness-check` (exhaustive outcomes like `behind | up_to_date | needs_base | ambiguous`), `unbound-method`, `no-non-null-assertion`, `no-confusing-non-null-assertion`, `no-unnecessary-type-assertion`, all five `no-unsafe-*` plus `no-unsafe-type-assertion` (added in tstack `bfa26c76`, 2026-11-23: no `as` casts that widen or lie about a type), `unicorn/prefer-set-has`.
  - Imports: `typescript/consistent-type-imports`, `import/consistent-type-specifier-style: prefer-top-level`.
  - `src/**` only: `eslint/no-magic-numbers` (ignore -1, 0, 1; `enforceConst`), so the 15 min, 20 s and 200 limits are named constants.
  - Custom JS plugin `scripts/oxlint/no-comments.js` (`tkitchen/no-comments`, shebang allowed), copied from tstack; a file that must keep a contract comment opts out with an `oxlint-disable` line and a reason, as tstack's `journal-export.ts` does.
  - `no-unsafe-type-assertion` has **no exemption** in `src/`: tstack exempts its journal files because they cast `node:sqlite` rows with `as`; tkitchen's `infrastructure/sqlite/` decodes each row through a small typed reader instead, since it is written fresh.
  - Overrides: tests (`tests/**`, `*.test.*`, `*.sim.ts`) turn off max-lines, complexity, magic numbers, non-null and `no-unsafe-*` (incl. `no-unsafe-type-assertion`); `**/*.js|mjs|cjs` turn off `no-unsafe-*`; `scripts/**` turns off complexity; fixtures turn off magic numbers. `ignorePatterns`: `.scratch`.
  - Not copied: `no-retired-names` and the companion, live-script and `scripts/support` overrides (tstack-only).
  — rationale: user asked for tstack's lint rules (2026-11-22). — evidence: GROUND-012 — depends on: D-002, D-011, D-012
  - Settled by: precedent (`F:/MyWork/tstack/.oxlintrc.json`, `scripts/oxlint/no-comments.js`)
  - Decided: the rule set as of tstack `bfa26c76` (2026-11-23), the no-comments rule, the overrides above; same `oxlint` (`^1.94.0`) and `@typescript/native-preview` dev versions as tstack. The env and layer rules stay in `verify:structure` (D-011, D-012), not lint.
  - Left to the implementer: whether type-aware linting needs an extra package on Node 22 (check how tstack resolves it), rule tweaks that keep the same intent.

## Steps

### Step 1 — Package scaffold
- Touches: `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.sim.config.ts`, `.oxlintrc.json`, `scripts/oxlint/no-comments.js`, `src/cli/tkitchen.ts`, `src/index.ts`, `scripts/check-module-structure.mjs`, `docs/MODULES.md` (all new; GROUND-007, GROUND-010, GROUND-011)
- Change: tstack-shaped package (D-002) with the four layers and the structure checker (D-011), including the rule that `Date`/timers/`Math.random`/`randomUUID` appear only in `infrastructure/` (D-012); tstack's lint rules and no-comments plugin (D-013); `lint`, `typecheck`, `test`, `test:sim`, `verify:structure` and an aggregate `verify` script; CLI dispatcher with `serve`, `round`, `notices`, `export`, `--help`.
- Done when: `npm test`, `npm run test:sim` (one placeholder sim), `npm run lint`, `npm run typecheck`, `npm run verify:structure` pass on Node 22.19+ and 26; a fixture importing `src/infrastructure` from `src/domain`, or calling `Date.now()` in `src/application`, makes `verify:structure` fail; lint fixtures with a floating promise, a comment, a magic number in `src/`, a non-exhaustive `switch`, and an unsafe `as` cast each fail `npm run lint`; after `npm link`, `tkitchen --help` prints usage.

### Step 2 — Domain model and ports
- Touches: `src/domain/trigger/`, `src/domain/disposition/`, `src/domain/branch/`, `src/domain/base/`, `src/domain/notice/`, `src/application/ports.ts` (new)
- Change: Trigger, Thread, Disposition, event id recipe (D-005); watched set, tree, staleness; pure `resolveBase(evidence)` → `{ base, evidence } | needs_base | ambiguous` (D-006, ported from `F:/MyWork/pi-selftools/saved-tools/github_publish_pbi_prs.ts`, GROUND-001); notice outcomes (D-009); every port (`EventStore`, `BranchStateStore`, `GitRepo`, `Forge`, `Config`, `Lock`, `Clock`, `Scheduler`, `Random`, `Ids`).
- Done when: pure unit tests cover every base rung and outcome from hand-built evidence (mismatch and two PRs → `ambiguous`, cycle rejected, reflog-tip tie → `needs_base`), the tree on the `main`→A, A→F, C→B, C→D example, and the event id recipe.

### Step 3 — DST world and doubles
- Touches: `tests/sim/world/`, `tests/sim/doubles/` (`SimRemote`, `SimForge`, sim env), `tests/sim/runner/`, `tests/sim/world.sim.ts` (new)
- Change: seeded RNG, virtual clock, trace + hash, scheduler-controlled port resolution, seed loop with `SIM_SEED`/`SIM_SEEDS` (D-012).
- Done when: the same seed gives the same trace hash twice; different seeds differ; a deliberate `Date.now()` leak in a test double fails the determinism check; `SimRemote` answers ancestry and behind counts for the example tree.

### Step 4 — Store
- Touches: `src/infrastructure/sqlite/` (new)
- Change: open/migrate (D-004), `insertEvent` (ignore on duplicate id), `recordDisposition`, `repo_heads` and `branch_state` read/replace.
- Done when: tests show a duplicate insert is a no-op, `seq` is monotonic, migration is idempotent, `branch_state` replace drops branches no longer watched.

### Step 5 — Real adapters and contract tests
- Touches: `src/infrastructure/git/`, `src/infrastructure/github/`, `src/infrastructure/config-file.ts`, `src/infrastructure/env.ts` (real clock/timers/random/ids), `tests/contract/` (new)
- Change: git runner with 20 s timeout and evidence readers; `GitHubForge` via `gh` (D-007); config loader (D-003); one contract suite run against both real adapters and the sim doubles (D-012).
- Done when: the contract suite passes for `SimRemote` and real git on temp repos (each base rung's evidence, ancestry, behind count, timeout), and for `SimForge` and the `gh` adapter on a recorded fixture; config tests cover missing file and bad repo path.

### Step 6 — Round and notice station under DST
- Touches: `src/application/round.ts`, `tests/sim/actors/`, `tests/sim/faults/`, `tests/sim/oracles/`, `tests/sim/round.sim.ts`, `tests/sim/scenarios/` (new)
- Change: the round use case (D-008, D-009) and the sweep with developer actors, git/gh faults and the safety and progress oracles.
- Done when: `npm run test:sim` passes its seed batch; pinned scenarios pass: first round fills `branch_state` without events; push to C → one event, B and D `behind`; quiet re-run adds no rows; B catches up → `up_to_date`; force-push C back and forth → `branch_state` still correct; `gh` failure → nothing advanced; PR retarget without a push → tree updates. **Harness proof:** removing the "recheck on child move" rule, or advancing `repo_heads` on a `gh` failure, makes the sweep fail and print a seed.

### Step 7 — `serve`, lock and launch task
- Touches: `src/application/serve.ts`, `src/infrastructure/lock-file.ts`, `src/cli/` (serve, round), `tests/sim/serve.sim.ts`, `deploy/windows/install-task.ps1`, `deploy/windows/uninstall-task.ps1`, `README.md` (new)
- Change: scheduler loop on the `Scheduler` port, single-instance lock with dead-pid takeover (D-001); crash/restart and second-instance faults in the sim; at-sign-in launch task (aiLau's script shape, logon trigger).
- Done when: sim oracles hold under crash/restart between any two steps and a second `serve`; a CLI test shows a second `serve` and a `round` exit with "already running"; `install-task.ps1 -Export <path>` writes XML without registering.

### Step 8 — `notices` CLI
- Touches: `src/application/notices.ts`, `src/cli/` (notices) (new)
- Change: open-notice query and output (D-009); the sim's human actor calls it and the oracle compares its `--json` output with ground truth.
- Done when: tests cover open, closed-by-catch-up, closed-by-leaving-the-watched-set, `needs_base`, `ambiguous`, `--history`, `--json`.

### Step 9 — `export` CLI
- Touches: `src/application/export.ts`, `src/cli/` (export) (new)
- Change: NDJSON export with cursor (D-010); the sim's human actor exports between rounds and the export oracle checks exactly-once order.
- Done when: tests cover empty store, resume after cursor, a cursor whose `seq` is missing, and a cursor whose `id` changed (reset); the export oracle holds across the sim batch.

## Tests

- Domain rules (event id, base resolution, tree, staleness, notice outcomes) — pure unit tests — `npm test`
- Round, serve, notices, export under seeded interleavings, faults and crashes — DST sweep with safety and progress oracles — `npm run test:sim` (replay: `SIM_SEED=<n> npm run test:sim`; batch: `SIM_SEEDS=5000 npm run test:sim`)
- Determinism of the harness — trace-hash self-check — `npm run test:sim`
- Real adapters match the doubles — shared contract suite, temp git repos and a recorded `gh` fixture — `npm test`
- Store dedupe and migration — unit, temp sqlite — `npm test`
- Layer and env rules — `npm run verify:structure`
- Lint rules (D-013) — `npm run lint`; all checks together — `npm run verify`
- Node 22 compatibility — no CI: run `npm test`, `npm run test:sim` and `tkitchen --help` under Node 22.22 on the work laptop once.
- Left untested: real `gh` against GitHub and the scheduled task on a real sign-in — manual smoke on each machine after install.

## Risks

- New contracts: the store schema (D-004) and `tkitchen.export/1` (D-010); aiNho will depend on the export, so changing it later needs a version bump.
- `gh` rate limits or auth loss make every round incomplete for that repo → notices freeze at the last complete round; `tkitchen notices` shows the last complete round time per repo and the round log shows the error.
- A crash leaves the lock file → taken over when its pid is dead.
- Reflog rungs differ between machines (each machine only knows its own branch creations), so two machines may resolve different bases for the same local-only branch; acceptable in v1 since dispositions stay per machine.
- Work laptop policy may block a resident process or scheduled task (A-002, A-005).

## Out of scope

- Forge producers (CI, review), refresh ladder, judge, watchdog, workspace (vault steps 8-12; ledger K1-K3, K6, K11).
- aiNho importer for `tkitchen.export/1` (aiNho repo, ledger K7) and aiNho Work Session explicit bases.
- Sharing base resolution with pi-selftools and herdr (ledger K8).
- Delivering notices to herdr, Teams, or the durable Pi (ledger K10 beyond v1).

## Size
deliveries=1 modules=1 contract=y
