---
status: ready-for-agent
source: quick-plan.md (READY_FOR_PRD 2026-11-22, D-013 revised 2026-11-23), ledger.md, grounding.md, CONTEXT.md
repo: F:/MyWork/tkitchen
---

# PRD: tkitchen v1 (git first)

## Problem Statement

The user works across many stacked branches (`main`→A, A→F, C→B, C→D) in several repos on two machines (home `DESKTOP-LJB4PL8`, a work laptop). When a base branch gets a push, nobody is told which branches cut from it are now behind; the user has to remember the tree, including teammates' branches. There is no event layer today (grounding background item 1): the durable Pi plan (vault note "Durable Pi orchestrating every branch", Build order step 6) needs one, and tkitchen is it. The repo is empty (GROUND-007).

## Solution

A small Node package, `tkitchen`, runs one resident process per machine. Every 15 minutes it runs a **Round** per configured repo: reads `origin`'s heads and the open GitHub PRs, finds each **Watched branch**'s **Base** automatically, writes a **Base moved** **Trigger** when a Base with children moves, and keeps a current table of who is behind. `tkitchen notices` shows the open **Notices**: behind by N, `needs_base`, or `ambiguous`. Notices close by themselves. `tkitchen export` streams Triggers for aiNho. v1 never writes to a repo. Terms are defined in `CONTEXT.md`.

## User Stories

1. As the user on either machine, I want a push to a base branch to show every watched child branch as behind in `tkitchen notices`, so that I don't have to track the branch tree myself.
2. As the user, I want a notice to close by itself when its branch catches up or stops being watched, so that the list only shows what still needs action.
3. As the user, I want bases found automatically for every author's branches, and branches with no or conflicting evidence shown as `needs_base` or `ambiguous` with a hint, so that I only write a config override when the evidence can't decide.
4. As the user, I want the kitchen to run on its own every 15 minutes after I sign in, so that notices are current without me running anything.
5. As the aiNho maintainer, I want to export the kitchen's Triggers as NDJSON with a resumable cursor, so that aiNho can import them later without duplicates.
6. As a tkitchen developer, I want every round, crash and fault interleaving tested by seeded simulation that replays from a seed, so that ordering and retry bugs are found before they reach a machine.

## Walking Skeleton

`US-001` — with a temp bare `origin`, a clone, and a config whose `bases` override names the parents, `tkitchen round --repo <name>` (first run, baseline) then a push to C then `tkitchen round` again makes `tkitchen notices --json` list B and D as `behind` C with `behindBy: 1`, and nothing for A or F. Real CLI, real git, real `node:sqlite` file.

## Required Behaviors

- `RB-001`: A Round whose any git or `gh` call fails or exceeds 20 s is **incomplete**: it writes no Trigger, no Disposition, does not change `branch_state` and does not advance `repo_heads`; the next Round retries.
- `RB-002`: Re-running a Round with unchanged heads, PRs and config adds no rows to `event` or `disposition`. A Trigger id already stored is never inserted twice.
- `RB-003`: The first Round for a repo (no `repo_heads` rows) writes no Trigger but fills `branch_state`, so a branch already behind shows at once.
- `RB-004`: No store transaction is open while a port call to git, `gh`, the clock or the scheduler is pending; a Round collects first and writes in one short transaction.
- `RB-005`: At most one `tkitchen serve` runs per store; a second `serve` and any `tkitchen round` exit non-zero with `already running` while it runs; a lock whose pid is dead is taken over.
- `RB-006`: Each Round reads the config and the open-PR list, even when heads are unchanged, so a retargeted or new PR and a new override are seen without a push.
- `RB-007`: tkitchen never writes to a repo: the only git commands are `ls-remote --symref`, `fetch --prune`, `for-each-ref`, `rev-parse`, `reflog show`, `merge-base --is-ancestor`, `rev-list --count`.
- `RB-008`: Runs on Node `>=22.19.0` (work laptop 22.22.1, home 26.3) with no runtime dependencies besides Node built-ins.
- `RB-009`: `tkitchen export` emits Triggers only; `disposition`, `branch_state` and `repo_heads` never leave the machine.
- `RB-010`: `npm run verify` enforces the layer rule (domain imports only domain), the env rule (`Date`, timers, `Math.random`, `crypto.randomUUID` only in `src/infrastructure/`), the 800-line module budget, and the D-013 lint rules.
- `RB-011`: Workload target (measured, not a gate): a quiet Round costs one `git ls-remote` and one `gh pr list` per repo, about 3-4 s on home; a Round with fetch 6-13 s (home, 2026-11-22); the DST CI seed batch finishes in under 1 minute.
- `RB-012`: aiNho, pi-selftools (`saved-tools/github_publish_pbi_prs.ts`) and herdr (`herdr-app/mods/github-prs/merge.js`) are not changed by v1.

## Accepted Decision Register

### DEC-001 — Resident `tkitchen serve`
- **Decision**: one resident Node process per machine with an in-process scheduler running a Round per configured repo every 15 minutes, one repo at a time; `tkitchen round [--repo <name>]` runs the same code once. Launched at user sign-in by a launch-only per-user scheduled task (`deploy/windows/install-task.ps1`), on both machines (user confirmed the work laptop allows it).
- **Rationale**: later producers (forge, workspace, watchdog) become more loops in the same process sharing one store writer.
- **Rejected alternatives**: a scheduled task that runs `tkitchen round` every 15 min (no home for later producers); hosting in aiLau (needs Node 26) or herdr (a UI); boot trigger (git and `gh` need the user's credentials).
- **Downstream impact**: single-writer lock (RB-005); scheduler goes through the `Scheduler` port (DEC-012).
- **Depends on**: None
- **Decided implementation**: exclusive lock file next to the store holding the pid; dead pid → take over; `round` refuses while `serve` holds it; no bypass flag. Task registration copies aiLau `deploy/windows/install-task.ps1` (GROUND-006) with a logon trigger instead of a boot trigger and supports `-Export <path>`.
- **Left to the implementer**: log location and rotation, jitter, graceful shutdown.

### DEC-002 — Package shape copies tstack
- **Decision**: ESM TypeScript run directly by Node (built-in type stripping, no flag), `bin: { "tkitchen": "src/cli/tkitchen.ts" }` with `#!/usr/bin/env node`, `engines.node >=22.19.0`, `node:sqlite`, vitest, oxlint, `tsgo --noEmit`; library entry `src/index.ts`.
- **Rationale**: same toolchain the user runs in tstack (GROUND-005, GROUND-009).
- **Rejected alternatives**: `engines >=22.6` with `--experimental-strip-types` (first draft; wrong floor, F-006).
- **Downstream impact**: RB-008.
- **Depends on**: None
- **Decided implementation**: no runtime dependencies; dev dependencies pinned like tstack (`vitest 5.1.0`, `oxlint ^1.94.0`, `@typescript/native-preview 7.0.0-dev.20260707.2`, `typescript ^5.8.3`, `@types/node ^22.15.0`).
- **Left to the implementer**: tsconfig details.

### DEC-003 — Per-machine config
- **Decision**: `~/.tkitchen/config.json` = `{ "repos": [{ "name", "path", "remote"?: "origin", "forge"?: "github", "bases"?: { "<branch>": "<base>" } }], "roundMinutes"?: 15 }`; store `~/.tkitchen/kitchen.db`; both under `TKITCHEN_HOME` when set. Read at every Round.
- **Rationale**: user answer 2026-11-22.
- **Depends on**: None
- **Decided implementation**: `Config` port; `infrastructure/config-file.ts` validates and reports the bad field.
- **Left to the implementer**: validation message wording.

### DEC-004 — Store schema v1
- **Decision**: one `node:sqlite` file, migrated by `PRAGMA user_version`, four tables (normative snippet in Area: Store). `event` is immutable history; `disposition` is one row per `(event_id, thread, consumer)`; `repo_heads` caches the last complete `ls-remote`; `branch_state` is the current truth for Notices. No `effect` table in v1.
- **Rationale**: one Base moved Trigger fans out to several children, each with its own outcome; a current-state table lets a first-run scan and a deduped repeat head stay correct without extra Triggers (F-007, F-009, F-010).
- **Rejected alternatives**: an observation Trigger for every state change; a transition generation in the Trigger id.
- **Depends on**: None
- **Decided implementation**: table names, keys, `seq`, migration mechanism, history vs current-state split; `INSERT OR IGNORE` on `event.id`.
- **Left to the implementer**: indexes.

### DEC-005 — Trigger id recipe (git)
- **Decision**: `id = sha256("git-base\0" + repo + "\0" + base + "\0" + newHead)` hex; `source: "git"`, `actor: "git"`, `human: false`, `addressed: null`, `threads` = `git:<repo>:<child>` per child, `meta: { base, oldHead, newHead }`, `machine = os.hostname()`.
- **Rationale**: vault plan "ID recipe": source identity + version; a re-poll is a duplicate, a new push a new Trigger.
- **Depends on**: DEC-004
- **Decided implementation**: pure function in `src/domain/trigger/`.
- **Left to the implementer**: none.

### DEC-006 — Base detection is automatic and kitchen-owned
- **Decision**: rungs in order: explicit (`config.bases`) → open PR target → creation reflog naming a branch (ancestry-verified) → creation reflog tip (start commit was the tip of exactly one candidate at creation, ancestry-verified) → `needs_base`. Never merge-base. Explicit vs PR mismatch → `ambiguous`; two open PRs from one head → `ambiguous`; a cycle in the resulting tree → every branch on the cycle `ambiguous`.
- **Rationale**: pi-selftools' resolver is a saved-tool body bound to one org and PBI ids, not importable (GROUND-001); herdr stops on ambiguity and cycles (GROUND-003).
- **Rejected alternatives**: extract a shared package for pi-selftools and herdr now (ledger K8, later).
- **Depends on**: DEC-003, DEC-007, DEC-011
- **Decided implementation**: pure `resolveBase(evidence)` in `src/domain/base/`; `GitRepo` gathers reflog evidence, `Forge` gathers PRs. Reflog rungs only see branches created on this machine.
- **Left to the implementer**: candidate cap (pi-selftools uses 200), helper names.

### DEC-007 — GitHub only, through `gh`, every Round
- **Decision**: `Forge.listOpenPullRequests(repo)` → `[{ number, head, base, url, author, crossRepository }]`; `GitHubForge` runs `gh pr list --state open --json number,headRefName,baseRefName,url,author,isCrossRepository --limit 200` in the repo directory with `GH_PROMPT_DISABLED=1`. Called every Round. A `gh` failure makes the Round incomplete (RB-001). PRs from forks (`isCrossRepository: true`) are ignored.
- **Rationale**: the tree is built downward from open PRs for every author; reflog only knows local branches. User confirmed the work repos are on GitHub (K11, 2026-11-22).
- **Rejected alternatives**: an Azure DevOps adapter in v1; reading PRs only when heads changed (F-002); degrading to reflog on `gh` failure (F-003).
- **Depends on**: DEC-011
- **Decided implementation**: `Forge` port; `src/infrastructure/github/`.
- **Left to the implementer**: JSON parsing details.

### DEC-008 — The Round
- **Decision**: per repo: read config, `git ls-remote --heads <remote>`, `Forge.listOpenPullRequests`. If heads differ from `repo_heads`: `git fetch <remote> --prune`. Build the Watched set (pushed; not the default branch, which is only a Base; head not an ancestor of its Base's head; head not an ancestor of another pushed head that is not one of its descendants in the tree), resolve Bases (DEC-006), build the child index. For each Base whose head moved and that has children: one Base moved Trigger (DEC-005) and one notice Disposition per child. Recompute staleness (`merge-base --is-ancestor <base> <child>`; `rev-list --count <child>..<base>`) for every child whose own head, Base head, or resolved Base changed since its `branch_state` row. Then in one transaction: Triggers, Dispositions, `branch_state` rewrite, `repo_heads` replace. 20 s timeout per call. First Round: RB-003.
- **Rationale**: vault plan "Round" plus fixes F-001, F-002, F-003, F-010.
- **Depends on**: DEC-003, DEC-004, DEC-005, DEC-006, DEC-007, DEC-009
- **Decided implementation**: `src/application/round.ts`; collect-then-write (RB-004); incomplete rule (RB-001).
- **Left to the implementer**: git output parsing.

### DEC-009 — Notice station and `tkitchen notices`
- **Decision**: station `consumer: "notice"`, `rule_id: "notice.base-moved"`, `policy_version: 1`; one Disposition per child Thread of each Base moved Trigger, `outcome` `behind` (`meta.behindBy`) or `up_to_date`. `tkitchen notices` reads `branch_state` rows whose `status` is `behind`, `needs_base` or `ambiguous`; prints repo, branch, base, evidence rung, behind count, last Trigger id, and the last complete Round time per repo; `needs_base` rows print the hint `add "bases": { "<branch>": "<base>" } to <config path>`. `--json` prints `{ notices: [...], rounds: [...] }`; `--history` lists Triggers with their Dispositions. No acknowledge verb.
- **Rationale**: user asked for `tkitchen notices` (2026-11-22).
- **Depends on**: DEC-004
- **Decided implementation**: `src/domain/notice/`, `src/application/notices.ts`, `src/cli/`.
- **Left to the implementer**: table formatting.

### DEC-010 — Export `tkitchen.export/1`
- **Decision**: `tkitchen export --json [--after <cursor>]` streams NDJSON: one `header` line `{ type: "header", schema: "tkitchen.export/1", machine, reset }`, `event` lines `{ type: "event", seq, id, source, threads, actor, human, addressed, at, text, channel, url, machine, meta }` in `seq` order, one `end` line `{ type: "end", cursor, events }`. Cursor = base64url JSON `{ s, id }`. A cursor whose `seq` is missing or whose `id` differs → `reset: true`, stream from the start. Stated limit: a replaced store identical up to the cursor is not detected (harmless: aiNho keeps rows by `(machine, id)`, ADR 0007).
- **Rationale**: same shape as `tstack journal export` (GROUND-004), one stream instead of two.
- **Depends on**: DEC-004
- **Decided implementation**: `src/application/export.ts`, `src/cli/`; RB-009.
- **Left to the implementer**: stream error handling.

### DEC-011 — DDD layers copied from tstack
- **Decision**: `src/domain` (pure; imports only `src/domain`), `src/application` (use cases + ports), `src/infrastructure` (adapters), `src/cli`. Dependency rule cli → application → domain; infrastructure implements application ports. Enforced by `scripts/check-module-structure.mjs` (copied from tstack, GROUND-010) in `npm run verify:structure`; layout in `docs/MODULES.md`.
- **Rationale**: user asked for DDD; tstack runs this exact shape.
- **Rejected alternatives**: feature folders without layers (first draft).
- **Depends on**: DEC-002
- **Decided implementation**: the layout in Area: Package; ports listed in Area: Ports.
- **Left to the implementer**: file names inside a layer.

### DEC-012 — DST is the main test layer
- **Decision**: copy tstack's DST harness shape (GROUND-011) with an injected Env port (`Clock`, `Scheduler`, `Random`, `Ids`) instead of global fakes. The real application code, notice station, store and export run against `SimRemote` (in-memory commits, branches, reflogs, ancestry) and `SimForge`; a seed drives actors, faults and port resolution; oracles run after every step; `SIM_SEED=<n>` replays; one contract suite runs against each double and its real adapter.
- **Rationale**: user asked for DST as the test base; a new codebase can inject the env port cheaply (tstack's overview names it the complete option).
- **Rejected alternatives**: tstack's global fakes (approach B).
- **Depends on**: DEC-011
- **Decided implementation**: `tests/sim/{world,doubles,actors,faults,oracles,runner,scenarios}/`, `vitest.sim.config.ts` including `tests/sim/**/*.sim.ts`, `npm run test:sim`; real `node:sqlite` on a temp file; real git and `gh` forbidden inside a sim run; oracles listed in Testing Decisions.
- **Left to the implementer**: shrinking (not v1), actor weights, batch size.

### DEC-013 — Lint rules copied from tstack (snapshot `bfa26c76`)
- **Decision**: `.oxlintrc.json` copied from tstack at `bfa26c76` (GROUND-012) minus tstack-only parts: plugins `typescript, unicorn, oxc, import`; `typeAware: true`; `categories.correctness: off`; the explicit rule list (Area: Quality gate); `no-magic-numbers` in `src/**`; JS plugin `scripts/oxlint/no-comments.js` as `tkitchen/no-comments`; `no-unsafe-type-assertion` with no exemption in `src/` (sqlite rows are decoded by a typed reader).
- **Rationale**: user asked for tstack's lint rules, then for tstack's 2026-11-23 update.
- **Rejected alternatives**: exempting `src/infrastructure/sqlite/` like tstack's journal files; dropping no-comments.
- **Depends on**: DEC-002, DEC-011, DEC-012
- **Decided implementation**: rule set and overrides in Area: Quality gate.
- **Left to the implementer**: how type-aware linting resolves its backend (copy whatever makes `npm run lint` work in tstack).

## Implementation Plan

### Area: Package
- **Coverage**: DEC-002, DEC-011, RB-008, US-001
- **Contract**: `package.json` `"type": "module"`, `bin.tkitchen = "src/cli/tkitchen.ts"`, `engines.node ">=22.19.0"`, scripts `lint` (`oxlint`), `typecheck` (`tsgo --noEmit`), `test` (`vitest run`), `test:sim` (`vitest run --config vitest.sim.config.ts`), `verify:structure` (`node scripts/check-module-structure.mjs`), `verify` (all of them). CLI subcommands `serve`, `round [--repo <name>]`, `notices [--json] [--history]`, `export --json [--after <cursor>]`, `--help`.
- **Decision constraints**: DEC-011 layout:
  ```text
  src/domain/{trigger,disposition,branch,base,notice}/
  src/application/{ports.ts,round.ts,serve.ts,notices.ts,export.ts}
  src/infrastructure/{sqlite/,git/,github/,config-file.ts,lock-file.ts,env.ts}
  src/cli/tkitchen.ts
  src/index.ts
  ```
- **Required edits**: create the files above, `tsconfig.json`, `vitest.config.ts`, `vitest.sim.config.ts`, `docs/MODULES.md`, `README.md`.
- **Test seam**: `npm test` (vitest) — new; precedent `F:/MyWork/tstack/vitest.config.ts`.
- **Wiring**: `npm link` exposes `tkitchen`.
- **Grounding evidence**: GROUND-005, GROUND-007, GROUND-009, GROUND-010

### Area: Ports
- **Coverage**: DEC-011, DEC-012, RB-004
- **Contract** (normative):
  ```ts
  interface Clock { now(): Date }
  interface Scheduler { sleep(ms: number): Promise<void> }
  interface Random { next(): number }
  interface Ids { next(): string }
  interface GitRepo {
    lsRemoteHeads(remote: string): Promise<{ heads: Map<string, string>; defaultBranch: string | null }>;
    fetch(remote: string): Promise<void>;
    isAncestor(ancestor: string, descendant: string): Promise<boolean>;
    countBehind(child: string, base: string): Promise<number>;
    creationReflog(branch: string): Promise<CreationEntry | null>;
    tipAt(ref: string, unixSeconds: number): Promise<string | null>;
  }
  interface Forge { listOpenPullRequests(repo: RepoConfig): Promise<PullRequest[]> }
  interface Config { load(): Promise<KitchenConfig> }
  interface Lock { acquire(): Promise<"acquired" | "held">; release(): Promise<void> }
  ```
  Every port failure is a typed `PortError` with `kind: "timeout" | "failed"`; any `PortError` makes the Round incomplete.
- **Required edits**: `src/application/ports.ts`; real implementations in `src/infrastructure/`; sim implementations in `tests/sim/doubles/`.
- **Test seam**: contract suite `tests/contract/` runs against both.
- **Wiring**: `src/cli/tkitchen.ts` composes real adapters; sims compose doubles.

### Area: Store
- **Coverage**: DEC-004, DEC-005, RB-002, RB-004, RB-009
- **Contract** (normative):
  ```sql
  CREATE TABLE event (id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, source TEXT NOT NULL,
    threads TEXT NOT NULL, actor TEXT NOT NULL, human INTEGER NOT NULL, addressed TEXT,
    at TEXT NOT NULL, text TEXT, channel TEXT, url TEXT, machine TEXT NOT NULL, meta TEXT NOT NULL);
  CREATE TABLE disposition (event_id TEXT NOT NULL REFERENCES event(id), thread TEXT NOT NULL,
    consumer TEXT NOT NULL, filtered INTEGER NOT NULL, outcome TEXT NOT NULL, outcome_event_id TEXT,
    rule_id TEXT NOT NULL, policy_version INTEGER NOT NULL, handbacks TEXT NOT NULL DEFAULT '[]',
    at TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (event_id, thread, consumer));
  CREATE TABLE repo_heads (repo TEXT NOT NULL, branch TEXT NOT NULL, oid TEXT NOT NULL,
    seen_at TEXT NOT NULL, PRIMARY KEY (repo, branch));
  CREATE TABLE branch_state (repo TEXT NOT NULL, branch TEXT NOT NULL, base TEXT,
    base_evidence TEXT, head_oid TEXT NOT NULL, base_oid TEXT, behind_by INTEGER,
    status TEXT NOT NULL CHECK (status IN ('up_to_date','behind','needs_base','ambiguous')),
    since TEXT NOT NULL, last_event_id TEXT, PRIMARY KEY (repo, branch));
  CREATE TABLE round_status (repo TEXT PRIMARY KEY, last_complete_at TEXT, last_error TEXT);
  ```
  `user_version = 1`. `round_status` holds the last complete Round time shown by `notices` (DEC-009) and the last incomplete reason.
- **Required edits**: `src/infrastructure/sqlite/` with a typed row reader (DEC-013: no `as` casts).
- **Test seam**: `npm test` → store tests on a temp file.
- **Grounding evidence**: GROUND-004 (DatabaseSync usage)

### Area: Git and GitHub adapters
- **Coverage**: DEC-006, DEC-007, RB-001, RB-007
- **Contract**: commands limited to RB-007; each spawned with a 20 s timeout and `GIT_TERMINAL_PROMPT=0`; `gh` with `GH_PROMPT_DISABLED=1`.
- **Required edits**: `src/infrastructure/git/`, `src/infrastructure/github/`.
- **Test seam**: contract suite against temp repos and a recorded `gh` JSON fixture.
- **Grounding evidence**: GROUND-001, GROUND-002, GROUND-003

### Area: Round and notice station
- **Coverage**: DEC-005, DEC-006, DEC-008, DEC-009, US-001, US-002, US-003, RB-001..RB-004, RB-006
- **Contract**: DEC-008; domain functions `watchedSet`, `buildTree`, `resolveBase`, `staleness`, `noticeOutcome` are pure.
- **Required edits**: `src/domain/*`, `src/application/round.ts`, `src/application/notices.ts`.
- **Test seam**: CLI integration test (walking skeleton) and DST sweep.

### Area: Serve and launch
- **Coverage**: DEC-001, US-004, RB-005
- **Required edits**: `src/application/serve.ts`, `src/infrastructure/lock-file.ts`, `deploy/windows/install-task.ps1`, `deploy/windows/uninstall-task.ps1`.
- **Test seam**: DST crash/restart faults; CLI test for `already running`; `install-task.ps1 -Export`.
- **Grounding evidence**: GROUND-006

### Area: Export
- **Coverage**: DEC-010, US-005, RB-009
- **Required edits**: `src/application/export.ts`, `src/cli/`.
- **Test seam**: export unit tests and the export oracle in DST.
- **Grounding evidence**: GROUND-004

### Area: DST harness
- **Coverage**: DEC-012, US-006, RB-004
- **Required edits**: `tests/sim/**`, `tests/contract/**`, `vitest.sim.config.ts`.
- **Test seam**: `npm run test:sim`; `SIM_SEED=<n> npm run test:sim`.
- **Grounding evidence**: GROUND-011

### Area: Quality gate
- **Coverage**: DEC-011, DEC-013, RB-010
- **Contract**: rules: `eslint/max-lines` 1000, `eslint/complexity` 20, `eslint/no-else-return`, `eslint/eqeqeq`, `eslint/no-eval`, `import/no-self-import`, `tkitchen/no-comments`, `typescript/no-floating-promises`, `typescript/no-misused-promises`, `typescript/use-unknown-in-catch-callback-variable`, `typescript/only-throw-error`, `eslint/no-promise-executor-return`, `typescript/switch-exhaustiveness-check` (`allowDefaultCaseForExhaustiveSwitch`, `considerDefaultExhaustiveForUnions`), `typescript/unbound-method`, `typescript/no-confusing-non-null-assertion`, `typescript/no-non-null-assertion`, `typescript/no-unnecessary-type-assertion`, `typescript/no-unsafe-{argument,assignment,call,member-access,return}`, `typescript/no-unsafe-type-assertion`, `unicorn/prefer-set-has`, `typescript/consistent-type-imports` (`disallowTypeAnnotations: false`), `import/consistent-type-specifier-style: prefer-top-level`. Overrides: `src/**` `eslint/no-magic-numbers` (`ignore [-1,0,1]`, `ignoreArrayIndexes`, `ignoreNumericLiteralTypes`, `enforceConst`, `detectObjects`); `scripts/**` complexity off and unsafe rules off; `**/*.{js,mjs,cjs}` unsafe rules off; fixtures magic numbers off; tests (`**/tests/**`, `*.test.*`, `*.sim.ts`) max-lines, complexity, magic numbers, non-null, only-throw-error, unbound-method and all unsafe rules off. `ignorePatterns: [".scratch"]`. Structure checker: domain purity, env rule, 800-line budget.
- **Required edits**: `.oxlintrc.json`, `scripts/oxlint/no-comments.js`, `scripts/check-module-structure.mjs`, `tests/quality/fixtures/`.
- **Grounding evidence**: GROUND-010, GROUND-012

## Global Build & Wiring Notes

- All commands run from `F:/MyWork/tkitchen`. `npm run verify` = `lint` + `typecheck` + `verify:structure` + `test` + `test:sim`.
- DST runs need `TEMP`/`TMP` pointing at a writable scratch folder (tstack precedent) for temp sqlite files.

## Testing Decisions

- Pure domain unit tests (`npm test`): Trigger id, `resolveBase` rungs and outcomes, `watchedSet`, `buildTree`, `staleness`, notice outcomes.
- Contract suite (`npm test`, `tests/contract/`): one suite per port run against the sim double and the real adapter (temp git repos; recorded `gh` JSON).
- CLI integration (`npm test`): the walking skeleton through `tkitchen round` and `tkitchen notices --json` with real git and sqlite.
- DST (`npm run test:sim`), oracles: **ground truth** (after every complete Round, `branch_state` equals what `SimRemote` + `SimForge` + config imply); **incomplete changes nothing** (RB-001); **no duplicate rows on re-poll** (RB-002); **single writer** (RB-005); **no transaction across a port call** (RB-004); **export exactly once in order across resets** (DEC-010); **progress** (after the world is quiet, notices match ground truth within one complete Round). Determinism self-check: same seed → same trace hash.
- Harness proofs: removing the child-move recheck, or advancing `repo_heads` on a `gh` failure, makes the sweep fail and print a seed.
- Prior art: `F:/MyWork/tstack/tests/sim/`, `F:/MyWork/tstack/vitest.sim.config.ts`.
- Manual (HITL): real `gh` on both machines, the sign-in task, Node 22.22.

## Out of Scope

- Rebase, push, or any repo write; forge CI, review comments, tstack dispatch, the workspace, judge, watchdog, refresh ladder (vault steps 8-12; ledger K1-K3, K6).
- The `effect` table.
- Azure DevOps.
- aiNho importer for `tkitchen.export/1` (ledger K7) and aiNho Work Session explicit bases.
- Sharing base resolution with pi-selftools and herdr (ledger K8).
- Delivering notices to herdr, Teams, or the durable Pi (K10 beyond v1).
- DST shrinking and transition coverage reports.

## Unresolved Gaps

None.

## Further Notes

- Grounding: `.scratch/tkitchen-v1/grounding.md`. Draft and check: `quick-plan.md`, `verification.md`. Glossary: `CONTEXT.md`.
- Refinements made while writing this PRD (recorded in `coverage-ledger.md` as findings): `round_status` table (home for the last complete Round time DEC-009 shows); fork PRs ignored (DEC-007); default branch from `ls-remote --symref` and the descendant exception in the Watched-set rule (DEC-008).
- The vault note stays the source of truth for the whole durable Pi plan; `plan.md` is its kitchen slice.
