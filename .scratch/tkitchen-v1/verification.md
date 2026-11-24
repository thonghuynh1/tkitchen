# Verification: tkitchen v1 quick plan

**Verdict: NEEDS GRILL** (verify-plan, fresh sub-agent sa-1/sa-2, 2026-11-22, against `quick-plan.md` first draft). The sub-agent had read tools only, no shell: `node --version`, tests, `gh`, and task registration were not run by it.

## Resolution by the author (after this check)

| Finding | Kind | Handled |
|---|---|---|
| F-001 catch-up never rechecked | fact-fix | Fixed in D-008: recheck a child when its own head, its base head, or its resolved base changed. Step 5 test extended. |
| F-002 config / PR changes unseen on quiet rounds | decision | Recommended in D-007/D-008: `gh` PR list and config read every round (one extra call per repo per 15 min). Ledger: accepted as recommended. |
| F-003 `gh` failure loses coverage | decision | Recommended: a forge failure makes the round incomplete; nothing advances; next round retries. Ledger: accepted as recommended. |
| F-004 work forge and `gh` access assumed | decision | Ledger: **open**, waits-on user (K11, A-001). |
| F-005 conflict / ambiguity unspecified | decision | Recommended: keep pi-selftools/herdr behaviour (`ambiguous`, cycles rejected). Ledger: accepted as recommended. |
| F-006 Node floor wrong | fact-fix | Fixed in D-002: `>=22.19.0` like tstack, no flag, `#!/usr/bin/env node` (GROUND-009). Step 1 tests the linked bin. |
| F-007 first-run `needs_base` has no event | decision | Recommended in D-004/D-009: a `branch_state` current-state table answers notices; events stay history. Ledger: accepted as recommended. |
| F-008 `round --force` bypass, stale lock | decision | Recommended in D-001: no bypass; dead-pid lock is taken over. Ledger: accepted as recommended. |
| F-009 repeated head deduped | decision | Resolved by `branch_state` (F-007): the plan's id recipe stays; current state is correct even when the repeat event is a duplicate. Ledger: accepted as recommended. |
| F-010 baseline and removed branches | decision | Recommended in D-008: first round fills `branch_state`; branches that leave the watched set are deleted, closing their notices. Ledger: accepted as recommended. |
| F-011 export reset limits | fact-fix | Fixed in D-010: relabelled `choice`, stated limit, Step 8 tests missing and changed cursors. |

Re-check of fact-fixes: F-001, F-006, F-011 edits re-read by the author against GROUND-004/009; not re-run by a second verifier.

## Checklist (as returned)

### Coverage
- ⚠️ Request mapping: Steps 3–7 cover per-machine repos, automatic base detection, notices and a resident process; Step 8 covers the export. Notice lifecycle and refresh did not meet the success case (F-001–F-003).
- ✅ Scope: non-goals and out-of-scope exclude repo writes, later producers and the aiNho importer; the `gh` lookup is explained.
- ❌ Named services and access: A-001 assumes GitHub and work access; ledger K11 leaves the work forge open (F-004).

### Grounding
- ⚠️ Existing paths and symbols: opened `pi-selftools/saved-tools/github_publish_pbi_prs.ts:392–449`, `my-pi/herdr-app/mods/github-prs/merge.js:66–145`, `tstack/src/cli/journal-export.ts:1–200`, `tstack/package.json`, `aiLau/deploy/windows/install-task.ps1`, `aiNho/docs/adr/0007-tstack-facts-sync-append-only.md`. Cited patterns exist.
- ⚠️ Current behaviour: resolver and herdr claims match; port left conflict handling unspecified (F-005); Node engine claim differed (F-006).
- ❌ Seams and wiring: store-to-notice seam lacked an event for initial `needs_base` (F-007); concurrency underspecified (F-008). No tkitchen module exists yet (GROUND-007).
- ⚠️ Patterns and project rules: AGENTS.md followed; no `CONTEXT.md` or `docs/adr/` yet.

### Decisions and assumptions
- ✅ D-001, D-003, D-004, D-006, D-007, D-009 marked `choice`.
- ❌ D-002 engine floor (F-006). ❌ D-005 repeated transitions (F-009). ❌ D-008 lifecycle and first round (F-001, F-007, F-010).
- ⚠️ D-010 contract differs from tstack (F-011).
- ⚠️ A-001 forge/access (F-004); A-002 launch policy; A-003 explicit-base substitution; A-004 hostname stability unverified; A-005 work-laptop validation; A-006 sizing unverified.
- ⚠️ D-008 interaction with D-007 failure semantics and D-009 lifecycle (F-001–F-003); D-001 lock is a new mechanism (F-008).

### Tests, risk and size
- ❌ Tests: Step 5 catch-up contradicted the algorithm (F-001); failure, retarget, repeated-head and concurrent-writer cases missing.
- ⚠️ Risk and size: schema/export and policy listed; incomplete forge snapshots, stale locks, identity reuse and initial state were not.
- ➖ Runtime: not run by the verifier. Knowledge: `node:sqlite` unflagged since Node 22.13.

## Findings

### F-001 — Catch-up cannot produce the promised closure ❌
- Plan said: D-008 checks children of branches whose heads moved; Step 5 expects B to close after B merges unchanged C.
- Code says: `plan.md` "Round" stale-checks children only after a base moves; no tkitchen round exists.
- Why it matters: B moving alone never rechecks B.
- Kind: fact-fix

### F-002 — Non-head changes are never refreshed ❌
- Plan said: D-003 reloads config each round; D-007 queries PRs only when heads change; D-008 stops on unchanged heads.
- Code says: `github_publish_pbi_prs.ts:392–399` reads explicit and PR bases independently of head changes.
- Why it matters: overrides and PR retargets stay invisible.
- Kind: decision — Options: refresh every round (recommended); manual invalidation.

### F-003 — Forge failure can make missing children permanent ❌
- Plan said: D-007 degrades to reflogs; D-008 advances `repo_heads`.
- Code says: `merge.js:125–145` reports incomplete/ambiguous/unavailable instead of treating them as complete.
- Kind: decision — Options: incomplete round, retry (recommended); partial results with retry marker.

### F-004 — Work forge and credentials are assumed ❌
- Plan said: A-001 GitHub + signed-in `gh`; D-007 GitHub only.
- Code says: `ledger.md` K11 open; `grounding.md` item 10 calls GitHub an inference.
- Kind: decision — Options: confirm remote and `gh` access first (recommended); accept GitHub-only v1 and defer ADO.

### F-005 — Base conflict and PR ambiguity unspecified ⚠️
- Code says: `github_publish_pbi_prs.ts:395–398` stops on explicit/PR mismatch; `merge.js:126–137` stops on multiple PRs and cycles.
- Kind: decision — Options: keep those outcomes (recommended); define a precedence.

### F-006 — Node floor and invocation unproven ❌
- Code says: `tstack/package.json` `>=22.19.0`; `tstack/src/cli/tstack.ts:1` plain `#!/usr/bin/env node`.
- Kind: fact-fix

### F-007 — Initial `needs_base` has no event ❌
- Code says: `plan.md` "Store" ties dispositions to events.
- Kind: decision — Options: observation event; separate current-state table (author recommends).

### F-008 — Lock bypass and stale locks ⚠️
- Code says: `aiLau/deploy/windows/install-task.ps1` relies on Task Scheduler `MultipleInstancesPolicy`, no shared lock protocol.
- Kind: decision — Options: no bypass + stale-lock takeover (recommended); IPC.

### F-009 — Repeated head suppresses a movement ❌
- Code says: `plan.md` "ID recipe"; ADR 0007 makes ids immutable.
- Kind: decision — Options: transition generation in the id; keep the recipe and derive state elsewhere (author recommends, via `branch_state`).

### F-010 — Baseline and removed-branch semantics ⚠️
- Kind: decision — Options: scan at baseline + resolve removed (recommended); movement-only with expiry.

### F-011 — Export reset limits and new contract ⚠️
- Code says: `journal-export.ts:1–11` documents undetectable resets.
- Kind: fact-fix
