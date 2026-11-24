# Ledger: tkitchen v1

Status: **consumed by to-prd, 2026-11-23** (PRD.md, issues/). Was: grilling from a draft, 2026-11-22. Paused before the first question earlier that day; resumed via pick-flow -> draft-plan (user asked for a quick plan). The v1 draft is `quick-plan.md`, its check `verification.md`; see **Draft-plan seed** at the end. Scope for the next session: **git only** (K9 settled). The kitchen's slice of the vault plan: `plan.md`.

Requirement: a standalone package, **tkitchen** (the kitchen), that takes orders (**Triggers**) from many producers, routes each to the stations (consumers) that handle it, and records what each station did. It is the event layer under the durable Pi (vault note "Durable Pi orchestrating every branch": the abstraction section, Corrections 1-2, Direction 2026-11-06). Loaded by pick-flow -> grill-with-docs, 2026-11-22.

## Carried in as accepted (user, 2026-11-22, in the session that started this grill)

- A1 accepted: name **tkitchen** for the package (renamed from kitchen 2026-11-22 to match tstack; "the kitchen" stays the plain-words name); one event record is a **Trigger** (plan and dsh-superagent vocabulary). Replaces the plan's working name "the yard".
- A2 accepted: not inside aiNho. aiNho is the trail, not the live bus (plan Correction 1). The kitchen owns its schema; aiNho imports kitchen records through a read-only export command, the same pattern as `tstack journal export` (aiNho ADR 0007).
- A3 accepted: its own repo, `F:/MyWork/tkitchen`, remote `github.com/thonghuynh1/tkitchen`.
- A4 accepted: shaped as Triggers from day one: an immutable **event** table + a **disposition** table; the **effect** table comes with the first real action. New stations start in **observe** mode (record what they would do).
- A5 accepted: branch base evidence order is the one already built in pi-selftools `github_publish_pbi_prs` (`saved-tools/github_publish_pbi_prs.ts:392-434`): explicit -> open PR target -> creation reflog (named) -> creation reflog-tip (commit that was the tip of exactly one candidate at creation) -> `needs_base`, never guessed. The branch tree is built downward from open PRs (all authors), so "C moved" reaches B and D whoever created C.
- A6 accepted (provisional, see K9): v1 dishes: git `base moved` -> notice; CI failed -> the worker that owns the branch.

## Open decisions

- K1 open, waits-on: user. **The workspace**: where people place orders by tagging ("fix bug", "investigate", ...), several users, replacing "pasted Teams/Slack discussion" (user, 2026-11-22). Candidates: a Teams or Slack channel, GitHub issue/PR comments, a web page.
- K2 open, waits-on: user. Who may place an order and which kinds each person may order (allowlist, trust, mandate per order; plan: untrusted text inlined as id + summary).
- K3 open, waits-on: user. Which station cooks a workspace order ("fix bug" -> tstack captain dispatch, a plain Pi agent, a human).
- K4 open, waits-on: user. Where the kitchen runs on each machine (standalone process started at power-on, inside aiLau at home, herdr), and how work laptop rules apply (outbound only, no inbound port, Node 22).
- K5 open, waits-on: repo. Store: one append-only `node:sqlite` file per machine (plan Correction 1).
- K6 open, waits-on: user. Which machine takes a workspace order when several users and two machines exist; crossing kinds over aiNho sync (plan Correction 1 table).
- K7 open, waits-on: repo. aiNho import of kitchen records (export command shape, cursor), mirroring tstack journal export.
- K8 open, waits-on: user. Shared base-evidence code: does the kitchen own it and pi-selftools + herdr `github-prs` import it, or does each keep its copy.
- K9 accepted (user, 2026-11-22): v1 is **git first**: the git producer (`base moved` fans out to the moved branch's children, bases per A5) and a notice station. Forge CI, tstack, the workspace port and other stations come later. A6's "CI failed -> owning worker" moves out of v1.
- K10 open, waits-on: user. How a notice reaches a person (terminal, herdr, Teams reply in the workspace, the durable Pi).
- K11 accepted (user, 2026-11-22, see Draft-plan seed): GitHub-only v1. Work forge: GitHub (inferred from `github.com/Aspia-MyBusiness/...` in my-home AGENTS.md) or Azure DevOps; plan open question.
- K12 open, waits-on: repo. Event identity recipe per producer (plan Direction 2026-11-06: source identity + version).

deliveries: 3 (core store + git producer/notice station; CI pass-through station; workspace order port); v1 = the first only
modules: 4 (kitchen new; aiNho importer; pi-selftools verbs; tstack or herdr hand-off)
contract: y (new schema, new export contract, new workspace order format)

## Draft-plan seed

seeded-from: quick-plan.md (v1, git first; K9). Situation answers (user, 2026-11-22): per-machine config listing repos; base detection automatic; a `tkitchen notices` command; a resident Node process, not a scheduled task running rounds.

### Accepted

- D-001 accepted (user, 2026-11-22; closes K4 for v1): one resident `tkitchen serve` process with its own 15-min scheduler; one-shot `tkitchen round`; launched at sign-in by a launch-only scheduled task (aiLau `deploy/windows/install-task.ps1` pattern, GROUND-006). Single-instance lock, no bypass, dead-pid takeover (F-008 recommended). depends on: A-002.
- D-002 accepted, source: precedent tstack `package.json` (GROUND-005, GROUND-009): ESM TS run by Node directly, `engines >=22.19.0`, `node:sqlite`, vitest, oxlint, no runtime deps.
- D-003 accepted (user, 2026-11-22): `~/.tkitchen/config.json` with `repos[{name,path,remote,forge,bases}]`, read each round; store `~/.tkitchen/kitchen.db`.
- D-005 accepted, source: plan "ID recipe" (closes K12 for git): `sha256("git-base", repo, base, newHead)`; repeats are duplicates (F-009 handled by D-004 `branch_state`).
- D-009 accepted (user asked for `tkitchen notices`, 2026-11-22; K10 for v1): notices read `branch_state` (`behind`, `needs_base`, `ambiguous`); dispositions per child thread on each `base moved` event; no ack verb.

### Accepted as recommended (the user can change any in one reply)

- D-004 recommended (K5): `event` (immutable, `seq` added), `disposition` keyed `(event_id, thread, consumer)`, `repo_heads` cache, and a new `branch_state` current-state table (F-007, F-009, F-010). Options: current-state table (recommended) | an observation event for every state change | a transition generation in the event id.
- D-006 recommended (K8 for v1): kitchen owns a ported resolver `src/base/resolve.ts`; pi-selftools and herdr keep their copies until a later sharing step. Options: own + port (recommended) | extract a shared package now.
- D-007 recommended: `Forge` seam, `GitHubForge` via `gh pr list`, called every round (F-002); a `gh` failure makes the round incomplete and nothing advances (F-003); explicit/PR mismatch and multiple PRs -> `ambiguous`, cycles rejected (F-005). depends on: K11.
- D-007 amended (user, 2026-11-24, option A, after the slice-1 live run): a repo may set `"forge": "none"`; the kitchen then never runs `gh` for it and bases come from config and reflog only. F-002/F-003 apply to `"forge": "github"` (still the default). Why: `gh` on the home machine cannot see the private SSH-only repos, and SSH exposes no PR base. See issues/11-ssh-only-repos-forge-none.md.
- D-008 recommended: round = ls-remote + PR list + config each round; fetch only when heads changed; recheck a child when its head, base head, or resolved base changed (F-001); first round fills `branch_state` without events (F-010); 20 s timeouts; no transaction during git.
- D-010 recommended (K7, kitchen side): `tkitchen export --json [--after]`, `tkitchen.export/1`, events only, `(seq,id)` cursor with stated reset limit (F-011). aiNho importer out of scope.

### Open

- K11 / F-004 / A-001 accepted (user, 2026-11-22: option A): GitHub-only v1 via `gh`; ADO adapter later behind the same `Forge` seam. Was: is the work forge GitHub (`github.com/Aspia-MyBusiness/*`), and is `gh` on the work laptop signed in with read access to those repos? Recommendation: yes, GitHub-only v1; ADO adapter later behind the same `Forge` seam. Dependents: D-007, D-008, D-006 (PR rung).
- A-002 + A-005 accepted (user, 2026-11-22: option A): a per-user scheduled task launches `tkitchen serve` at sign-in on both machines; manual start stays a fallback. Was: does the work laptop allow a per-user scheduled task that starts a resident `node` process at sign-in (not boot, because git and `gh` need your credentials)? Recommendation: yes. Dependents: D-001, Step 6.

Not questions (implementer checks): A-004 hostname as machine id; A-006 repo count; Node 22.22 run of `npm test` on the work laptop.

deliveries: 1 (v1 = core store + git producer + notice station + export)
modules: 1 (tkitchen only; aiNho importer, pi-selftools, herdr untouched)
contract: y (new store schema, `tkitchen.export/1`)
Size check: deliveries=1 modules=1 contract=y open=2 trend=- (draft seeded; K-list narrowed to v1)
Size check: open=1 closed=1 waits=[] deliveries=1 modules=1 contract=y trend=-
Size check: open=0 closed=2 waits=[] deliveries=1 modules=1 contract=y trend=-
- D-011 accepted as recommended, source: precedent tstack layering (GROUND-010), user asked for DDD 2026-11-22: `src/domain` (pure) / `application` (use cases + ports) / `infrastructure` (sqlite, git, gh, config, lock) / `cli`; domain-purity + 800-line checker copied from tstack. Base resolution split: domain decides from evidence, infrastructure gathers evidence. Options: tstack layering (recommended) | feature folders without layers (first draft).
Size check: open=0 closed=3 waits=[] deliveries=1 modules=1 contract=y trend=-
- D-012 accepted as recommended, source: precedent tstack DST (GROUND-011), user asked for DST as test base 2026-11-22: real application/store under a seeded sim world (SimRemote, SimForge, virtual clock), actors, faults incl. crash/restart, safety + progress oracles, SIM_SEED replay, shared adapter contract suite. Deviation from tstack: injected env port (approach A) instead of global fakes (B), because the codebase is new. Steps restructured 1-9. Options: approach A (recommended) | tstack's global fakes (B).
Size check: open=0 closed=4 waits=[] deliveries=1 modules=1 contract=y trend=-
- D-013 accepted as recommended, source: precedent tstack `.oxlintrc.json` + `scripts/oxlint/no-comments.js` (GROUND-012), user asked 2026-11-22: same plugins, type-aware promise and unsafe-type rules, exhaustive switch, magic numbers in `src/`, no comments, test overrides; tstack-only rules (retired names, companion, live scripts) not copied. Options: full copy incl. no-comments (recommended, "just like tstack") | copy without no-comments.
Size check: open=0 closed=5 waits=[] deliveries=1 modules=1 contract=y trend=-
- D-013 revised (user, 2026-11-23: "tstack updated lint, update ours"): add `typescript/no-unsafe-type-assertion` from tstack `bfa26c76`, off in tests/scripts/js like tstack; recommended no exemption for `src/infrastructure/sqlite/` (tkitchen decodes rows with a typed reader instead of tstack's journal casts). Options: no exemption (recommended) | exempt the sqlite folder like tstack's journal. Snapshot: tstack `bfa26c76`. READY_FOR_PRD stands; the change is local to D-013 and Step 1.
Size check: open=0 closed=5 waits=[] deliveries=1 modules=1 contract=y trend==

## Edges (user confirmed 2026-11-22)

- Callers and consumers: aiNho will import `tkitchen.export/1` later (K7, aiNho repo, not v1); pi-selftools and herdr unchanged; nothing else reads the kitchen.
- Workload: single digits to low tens of repos per machine; quiet round = 1 `ls-remote` + 1 `gh` call (~3-4 s per repo); round with fetch 6-13 s (home, 2026-11-22); DST seed batch < 1 min.
- Setup and rollout: both machines, Node >=22.19, `gh` signed in, git credentials for `origin`, per-user sign-in task; no existing data.

## Grill outcome

READY_FOR_PRD (user confirmed the walkthrough, 2026-11-22). Exit: medium (deliveries=1, modules=1, contract=y) -> to-prd -> to-issues. Domain changes: `CONTEXT.md` created (Trigger, Thread, Disposition, Producer, Station, Round, Watched branch, Base, Base evidence, Base moved, Notice). No ADR yet; candidate for to-prd: D-004 history vs current-state split.
