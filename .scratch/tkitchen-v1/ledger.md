# Ledger: tkitchen v1

Status: **paused by the user, 2026-11-22**, before the first question. Resume with `pick-flow: resume grill .scratch/tkitchen-v1/`. Scope for the next session: **git only** (K9 settled). The kitchen's slice of the vault plan: `plan.md`.

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
- K11 open, waits-on: research-external. Work forge: GitHub (inferred from `github.com/Aspia-MyBusiness/...` in my-home AGENTS.md) or Azure DevOps; plan open question.
- K12 open, waits-on: repo. Event identity recipe per producer (plan Direction 2026-11-06: source identity + version).

deliveries: 3 (core store + git producer/notice station; CI pass-through station; workspace order port); v1 = the first only
modules: 4 (kitchen new; aiNho importer; pi-selftools verbs; tstack or herdr hand-off)
contract: y (new schema, new export contract, new workspace order format)
