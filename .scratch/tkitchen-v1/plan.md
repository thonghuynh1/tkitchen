# Plan: tkitchen

The tkitchen slice of the vault note "Durable Pi orchestrating every branch" (`F:/Vault/ThongVault/NewVault/Ideas/`). The vault note is the source of truth for the whole durable Pi plan; this file holds only what the kitchen owns, copied 2026-11-22. When the two disagree, update the vault note first and this file in the same session. Section names in brackets point to the vault note.

Open decisions live in `ledger.md` (K1-K12); evidence lives in `grounding.md`.

## What the kitchen is

The kitchen takes orders (**Triggers**) from many producers, routes each to the **stations** that handle it, and records what each station did. It is the live event bus of the durable Pi plan, working name "the yard" until 2026-11-22. [Correction 1; Direction 2026-11-22]

- **Not aiNho.** aiNho is DuckDB, batch import, one writer: it is the *trail*, not the live bus. aiNho imports kitchen records through a read-only export command, the `tstack journal export` pattern (aiNho ADR 0007).
- **Not tstack.** tstack's journal is captain-shaped and per repo; coupling every producer to it is wrong. tstack dispatches into the kitchen and its CI babysitter becomes a kitchen producer later.
- **Not aiLau.** aiLau pins Node `>=26`; the work laptop runs Node 22. aiLau may host the kitchen at home at Stage 4.
- **Shape:** small Node 22 package, `node:sqlite` only, CLI + library, forge-agnostic. One append-only store per machine.

## Where it sits

```text
producers                         tkitchen (per machine)                 stations
git        base moved ──┐
forge      CI, review ──┤──▶ event (immutable) ──▶ route by thread ──▶ notice · refresh · owning worker
tstack     dispatch ────┤        disposition (per machine)            janitor · judge · watchdog · human
workspace  @order ──────┘        effect (after commit, later)
                                      │
                                      └──▶ export ──▶ aiNho (trail, synced across machines)
```

Who consumes what, and what crosses machines [Correction 1]:

| Kind | Consumed by | Crosses machines? |
|---|---|---|
| worker started/completed, touch | trail only | as history, at sync cadence |
| `base moved`, `check_suite`, review comment | the machine that owns the branch | only if owner is not the producer |
| decision filed, feature changed, note added | both | yes, fast |
| intent for machine X | X | yes |

## v1: git first [Direction 2026-11-22; Build order step 6]

`base moved` fans out to the children of the moved branch, whoever created them. Example tree: `main`→A, A→F, C→B, C→D. `main` moves → notice A. C moves → notice B and D. v1 stations only **notice**; no rebase, no push.

**Base of a branch, in this order** (already built in pi-selftools `saved-tools/github_publish_pbi_prs.ts:392-434`):

1. explicit (aiNho Work Session branch base, `aiNho work-session branch add --base`)
2. open PR target
3. creation reflog naming a branch (only the creation entry, ancestry-verified)
4. creation reflog-tip (the start commit was the tip of exactly one candidate branch at creation)
5. otherwise `needs_base`. Never guessed from merge-base: tested 2026-11-22 and rejected (merged-in children look like parents; ties across 15-35 old branches).

The tree is built **downward from open PRs** ("who targets C"), so it covers every author. my-pi herdr `github-prs` (`herdr-app/mods/github-prs/merge.js:66-145`) walks the same chain upward. Whether the kitchen owns this code and the others import it: ledger K8.

**Watched branches:** pushed (on `origin`), not merged into their base, not merged into another pushed branch. tstack's throwaway `tstack-<attemptId>` branches are never pushed, so they drop out.

**Round, per repo, every 15 min:** one `git ls-remote --heads origin`. Same heads → stop. Changed → `git fetch origin` → `base moved` event → stale check of each child (`merge-base --is-ancestor`, `rev-list --count`). Measured on home 2026-11-22: quiet round 2.9-3.0 s, round with fetch 6-13 s, CPU about 15 ms. Guards: about 20 s timeout per git call, skip the round on failure, no store transaction held during git.

**Poll, not webhook,** on both machines: one producer code path; the work laptop has no inbound port. A webhook only if measured poll latency hurts a real case. [Direction 2026-11-06, point 9]

## Store [Direction 2026-11-06]

- **event**, immutable, syncs as trail: `id, source, threads[], actor, human, addressed, at, text, channel, url, machine, meta`. `id` is the dedupe key. Trust comes from `actor` + `human` against an allowlist; all `text` is untrusted.
- **disposition**, per consuming machine, never crosses: `event_id, filtered, consumed_by, outcome_event_id, rule_id, policy_version, handbacks, at`. Two machines never write the same row.
- **effect**, per machine, **added with the first real action** (not v1): `kind, key, payload, attempts, due`, written in the same transaction as the state change and run after commit with backoff; keyed `(kind, key)` so a re-queue merges.

**ID recipe:** source identity + version. A re-poll is a duplicate; an edit is a new event.

- git base moved: `hash('git-base', repo, base, newHead)`, `human: false`, `threads` = every dependent branch.
- ADO PR comment: `hash('ado-comment', repo, prId, threadId, commentId, lastContentUpdatedDate)` (content date is a guess; check on a real PR).
- human note: `human: true`, `addressed: direct`, `actor` = the person.

**Threads, two kinds:** `git:<repo>:<branch>` and `<forge>:<repo>:<pr>`. A worker subscribes to both. Its base branch is followed for context only, so a commit on `main` is not routed as work to every worker; only `base moved` is.

## Rules for every station

- **Observe first.** A new station records what it would do (`would_accept`) and does nothing until promoted on evidence.
- **Fast path first:** deterministic code, then the judge, then the human. The human gets only what code and judge could not settle, in 100 words or less, with the event id.
- **Mandate.** Every automatic action records `rule_id` + `policy_version` in its disposition. Turning a rule off stops pending and resumed work that depended on it.
- **Batch per thread.** Pending events on one thread become one delivery.
- **Caps.** A global slot cap per machine, with one slot reserved for human-started work; per-branch budgets (CI fix budget 2, refresh per hour).
- **Hand-back.** A worker can return an event that is not its job: `handback(event_id, reason)`, recorded in the disposition.
- **Untrusted text** (review comments, teammate messages, workspace orders) is inlined as id + summary only; full text through a recall verb.
- **Human only, on the owning machine:** force-push to shared branches, deleting branches, anything on `main`, publishing.

## Later producers and stations (by vault Build order step)

| Step | Adds to the kitchen |
|---|---|
| 6 (v1) | git producer, notice station, event + disposition store, export for aiNho |
| 8 | human port: `note add` and the **workspace** (several people tag the kitchen to place orders; ledger K1-K3, K6) |
| 9 | refresh ladder station: L1 propose (`refresh/<branch>` in a throwaway worktree, tests, report), then L2 apply on private branches only (`--force-with-lease`, `before_head`/`after_head`, `undo`). L3 never: shared branches, `main`, a branch with a live worker (pass the event to the worker). Effect table arrives here. |
| 10 | forge producers (auto-arm, `check_suite`, review comment) → pass-through to the owning worker; janitor on tstack's `ci_fix_dispatches`; manual CI arm retired. Forge (GitHub or Azure DevOps) checked first (ledger K11). |
| 11 | judge station in shadow mode: deadline, then hold for the human; each answer records prompt version |
| 12 | watchdog station: liveness and progress, respects a manual stop marker |
| Stage 4 | aiLau may host the kitchen at home; the durable root (no `edit`/`write`/`bash`) reads it through pi-selftools verbs |

## Open, tracked elsewhere

- Ledger K1-K12 (`ledger.md`).
- aiNho `.scratch/live-memory/contract.md` still says live events are "not aiNho, decided at step 6"; now decided (the kitchen). Update in the next aiNho commit.
- The captain's `work-session branch add` step was never built; with bases from PRs and creation reflog, decide whether it is still needed.
