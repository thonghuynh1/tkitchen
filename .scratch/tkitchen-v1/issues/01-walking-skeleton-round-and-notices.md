---
repo: F:/MyWork/tkitchen
status: closed
type: AFK
covers: [US-001, DEC-002, DEC-003, DEC-004, DEC-005, DEC-008 (explicit bases only), DEC-009 (notices --json, open rows), DEC-011 (layout), RB-002, RB-003, RB-007, RB-008]
---

## Parent

`.scratch/tkitchen-v1/PRD.md` (walking skeleton `US-001`).

## What to build

The thinnest end-to-end path: a new Node package `tkitchen` whose `tkitchen round --repo <name>` reads a temp repo's `origin`, records a **Base moved** Trigger when a base with children moves, keeps `branch_state`, and whose `tkitchen notices --json` shows the children that are behind. Bases come **only from the config `bases` override** in this issue (PR and reflog rungs arrive in issues 04 and 05). Real CLI, real git, real `node:sqlite`.

Terms (from `CONTEXT.md`): **Trigger** (immutable record, table `event`), **Thread** (`git:<repo>:<branch>`), **Disposition** (one station's decision on one Trigger and Thread), **Round**, **Watched branch** (pushed, not merged into its base or another pushed branch), **Base**, **Notice**.

## Implementation map

**Package (DEC-002, DEC-011)** — the repo is empty today except `.scratch/`, `docs/agents/`, `AGENTS.md`, `CONTEXT.md` (GROUND-007).
- `package.json`: `"name": "tkitchen"`, `"type": "module"`, `"private": true`, `"bin": { "tkitchen": "src/cli/tkitchen.ts" }`, `"engines": { "node": ">=22.19.0" }`, scripts `"test": "vitest run"`, `"typecheck": "tsgo --noEmit"`. No runtime dependencies. devDependencies like tstack: `vitest 5.1.0`, `@types/node ^22.15.0`, `@typescript/native-preview 7.0.0-dev.20260707.2`, `typescript ^5.8.3`. (Lint, structure checker and `test:sim` come in issues 02 and 03.)
- `src/cli/tkitchen.ts` starts with `#!/usr/bin/env node` and runs directly under Node's built-in type stripping (tstack precedent: `F:/MyWork/tstack/src/cli/tstack.ts` line 1, `engines >=22.19.0`, GROUND-009).
- Layout (DEC-011): `src/domain/{trigger,disposition,branch,notice}/` pure, importing only `src/domain`; `src/application/{ports.ts,round.ts,notices.ts}`; `src/infrastructure/{sqlite/,git/,config-file.ts,env.ts}`; `src/cli/tkitchen.ts`; `src/index.ts`. `Date`, timers, `Math.random`, `crypto.randomUUID` are used **only** in `src/infrastructure/env.ts` (issue 02 enforces it).

**Ports (`src/application/ports.ts`)** — create these now; later issues extend `GitRepo` and add `Forge`, `Lock`:
```ts
export interface Clock { now(): Date }
export interface Scheduler { sleep(ms: number): Promise<void> }
export interface Random { next(): number }
export interface Ids { next(): string }
export interface GitRepo {
  lsRemoteHeads(remote: string): Promise<{ heads: Map<string, string>; defaultBranch: string | null }>;
  fetch(remote: string): Promise<void>;
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;
  countBehind(child: string, base: string): Promise<number>;
}
export interface Config { load(): Promise<KitchenConfig> }
export class PortError extends Error { constructor(readonly kind: "timeout" | "failed", message: string) { super(message) } }
```
Refs passed to `isAncestor`/`countBehind` are `refs/remotes/<remote>/<branch>`.

**Config (DEC-003)** — `src/infrastructure/config-file.ts` reads `$TKITCHEN_HOME/config.json` (default `~/.tkitchen/config.json`):
```json
{ "repos": [{ "name": "x", "path": "F:/r/x", "remote": "origin", "forge": "github", "bases": { "B": "C" } }], "roundMinutes": 15 }
```
`remote` defaults to `origin`, `forge` to `github`. Missing file or a repo whose `path` is not a git work tree → exit 2 with the offending field. Read at every Round.

**Store (DEC-004)** — `src/infrastructure/sqlite/`, file `$TKITCHEN_HOME/kitchen.db`, `DatabaseSync` from `node:sqlite`, `PRAGMA user_version = 1`, create all five tables now (exact DDL):
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
`insertEvent` is `INSERT OR IGNORE` on `id`; `seq` = max+1 inside the same transaction. Rows are read through a typed row reader (no `as` casts; issue 02's lint forbids them).

**Trigger id (DEC-005)** — pure, `src/domain/trigger/`: `id = sha256("git-base\0" + repo + "\0" + base + "\0" + newHead)` lowercase hex. Trigger fields: `source "git"`, `actor "git"`, `human false`, `addressed null`, `threads` = `["git:<repo>:<child>", …]` sorted, `meta { base, oldHead, newHead }`, `machine` = `os.hostname()` (via infrastructure), `at` = `Clock.now().toISOString()`.

**Round (DEC-008, explicit bases only)** — `src/application/round.ts`, per repo:
1. `Config.load()`; `GitRepo.lsRemoteHeads(remote)` → current heads.
2. If heads differ from `repo_heads` (or none stored): `GitRepo.fetch(remote)` (`git fetch <remote> --prune`).
3. Watched set (pure, `src/domain/branch/`): every remote head except (a) the default branch (from `git ls-remote --symref <remote> HEAD`; it is only ever a base), (b) a branch whose head is an ancestor of its base's head (merged into its base, or no own commits), (c) a branch whose head is an ancestor of another pushed head that is **not one of its descendants** in the base tree (merged elsewhere). Rule (c) excludes descendants because A's head is always an ancestor of its child F; the literal vault rule would drop A.
4. Base of each watched branch = `config.bases[branch]` when that base is a pushed head; otherwise the branch has no base in this issue (not shown; issue 04 adds `needs_base`).
5. Child index: base → children.
6. For each base whose head differs from `repo_heads` and that has children: one Base moved Trigger; for each child one Disposition `{ consumer: "notice", rule_id: "notice.base-moved", policy_version: 1, filtered: 0, outcome: "behind" | "up_to_date", meta: { behindBy } }`.
7. Staleness for every child whose head, base head or base changed since its `branch_state` row: `behindBy = countBehind(child, base)`; status `behind` when `behindBy > 0`, else `up_to_date`.
8. One transaction: Triggers, Dispositions, `branch_state` rewrite (delete rows for branches no longer watched), `repo_heads` replace, `round_status.last_complete_at`. **No transaction open while any port call is pending** (collect first).
9. **First Round** (no `repo_heads` rows for the repo): no Trigger, no Disposition, but `branch_state` filled (RB-003).
- git commands allowed (RB-007): `ls-remote --symref <remote> HEAD refs/heads/*` (one call), `fetch --prune`, `rev-parse`, `merge-base --is-ancestor`, `rev-list --count`. Spawn with `GIT_TERMINAL_PROMPT=0` and a 20 s timeout → `PortError("timeout")`. Any `PortError` aborts the Round with nothing written except `round_status.last_error` (full fault behaviour is proven in issue 06).

**Notices (DEC-009, open rows + `--json`)** — `src/application/notices.ts`, `tkitchen notices [--json]`: rows of `branch_state` with `status` in (`behind`,`needs_base`,`ambiguous`), ordered by repo, branch. JSON shape:
```json
{ "notices": [{ "repo": "x", "branch": "B", "base": "C", "evidence": "explicit", "status": "behind", "behindBy": 1, "lastEventId": "…" }],
  "rounds": [{ "repo": "x", "lastCompleteAt": "2026-…", "lastError": null }] }
```
Human output: one line per notice. (`--history` and the `needs_base` hint are issue 04's.)

**CLI** — `tkitchen round [--repo <name>]` runs the Round for one or all repos and exits 0 when every Round completed, 1 otherwise; `tkitchen notices`; `tkitchen --help`. `serve` and `export` print `not implemented yet` and exit 2 (issues 07, 09).

**Mechanics left to the implementer**: private helper names, file split inside each folder, test layout.

## Acceptance criteria

- [x] Walking skeleton: push to C marks B and D behind, nothing for A or F
  - Run: `npm test -- tests/cli/walking-skeleton.test.ts`
  - Test: `tests/cli/walking-skeleton.test.ts` → `push to base marks children behind` (planned). Fixture: temp dir as `TKITCHEN_HOME` (not `~`), a bare `origin`, a clone with `main`, A from main, F from A, C from main, B and D from C, all pushed; config `bases: { A: "main", F: "A", C: "main", B: "C", D: "C" }`. Spawn the real bin (`node src/cli/tkitchen.ts round --repo x`), push one commit to C from a second clone, run `round` again, then `notices --json`.
  - Expected: `notices` = exactly `[{branch:"B",base:"C",status:"behind",behindBy:1,evidence:"explicit"}, {branch:"D",…same}]` (plus `repo`, `lastEventId` equal to the one `event` row's id); `event` has 1 row whose `threads` = `["git:x:B","git:x:D"]`; `disposition` has 2 rows.
  - Fails when: the Round skips the fetch, ignores `bases`, routes to A/F, or `notices` reads anything but `branch_state`.
- [x] First Round is a baseline (RB-003)
  - Run: same file → `first round writes no trigger but fills branch_state`
  - Expected: after one `round` on a repo where B is already 1 behind C: `event` 0 rows, `disposition` 0 rows, `notices` lists B `behind` 1.
  - Fails when: the first Round emits Triggers or leaves `branch_state` empty.
- [x] Quiet re-run adds nothing (RB-002)
  - Run: same file → `rerun with no push adds no rows`
  - Expected: row counts of `event` and `disposition` identical before and after a third `round`.
  - Fails when: the Trigger id is not deterministic or the insert is not `OR IGNORE`.
- [x] A child that catches up closes its notice (F-001 rule)
  - Run: same file → `child merge closes notice`
  - Expected: after merging C into B and pushing B, the next `round` → B absent from `notices`, its `branch_state.status = "up_to_date"`.
  - Fails when: staleness is recomputed only when a base moves.
- [x] Trigger id recipe
  - Run: `npm test -- tests/domain/trigger.test.ts`
  - Expected: `triggerId("x","C","<40-hex>")` equals the sha256 hex of `"git-base\0x\0C\0<40-hex>"`; changing `newHead` changes it.
  - Fails when: separator or field order differs.
- [x] Store migration and dedupe
  - Run: `npm test -- tests/infrastructure/sqlite.test.ts`
  - Expected: opening twice leaves `user_version = 1` and the five tables; inserting the same Trigger twice leaves 1 row; `seq` values are 1, 2 for two distinct Triggers.
  - Fails when: migration re-runs DDL or `seq` is not monotonic.
- [x] Never writes to a repo (RB-007)
  - Run: same walking-skeleton file → `round runs only read commands`
  - Expected: a recording wrapper around the git runner sees only `ls-remote`, `fetch`, `rev-parse`, `merge-base`, `rev-list`; the bare origin's refs are unchanged by `round`.
  - Fails when: any `push`, `update-ref`, `checkout`, `rebase` is spawned.
- [x] Runs on Node ≥22.19 without flags (RB-008)
  - Run: `node src/cli/tkitchen.ts --help`
  - Expected: usage text listing `serve`, `round`, `notices`, `export`; exit 0; no `--experimental` flag needed on Node 26 here.
  - Fails when: the bin needs a build step or a flag.
- [x] Bad config is rejected without writing
  - Run: `npm test -- tests/infrastructure/config-file.test.ts`
  - Expected: missing file → exit 2 naming the path; a repo path that is not a git work tree → exit 2 naming `repos[0].path`; no `kitchen.db` rows written.
  - Fails when: a bad config produces a partial Round.

## Blocked by

None - can start immediately.

## Independent QA (qa-01)

verdict: pass
commit:8308f71146fba6d5dc532e1c309e1c4bd632e432

All nine existing tests and tsgo typecheck passed independently. Additional real-git CLI probes passed for exact Trigger/Disposition fields, config-only Base changes, quiet reruns, failed-Round atomicity and recovery, pushed-branch deletion, and deferred commands.

Evidence: `F:/MyWork/tkitchen/.verification-evidence/qa-01-review.md`, with rerunnable probe, raw probe output, check transcript, and SHA-256 source snapshot alongside it.

Qualification: the hash above is repository HEAD, but the implementation remains untracked at that HEAD. This verdict covers the hashed working-tree snapshot, not committed implementation contents, and does not authorize a merge. No source edits were made. Status remains ready-for-human.
