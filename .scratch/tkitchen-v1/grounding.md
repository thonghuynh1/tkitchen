# Grounding: tkitchen v1

Checked 2026-11-22 on home. Node v26.3.0 here; work laptop Node 22.22.1 (plan P1).

## Background block (digest)

1. Today [K9,K10]: no event layer. Plan design only: vault note "Durable Pi orchestrating every branch", sections "The abstraction: one event table", "Correction 1", "Direction (2026-11-06)".
2. Prior art [A4,K12,K2]: dsh-superagent `8c32a9d` (not cloned locally): Trigger `src/core/model.ts:22-39`, disposition `:42-63`, effects `src/app/effects.ts:57-62`, policy/mandate `src/policy.ts:171-243`, SourceKind plugins `src/sources/kind.ts:85-115` (GitHub, Feishu chat with @mention = `addressed`).
3. Prior art [A5,K8]: pi-selftools `saved-tools/github_publish_pbi_prs.ts:392-434` and `github_merge_pbi_base.ts` (base evidence order, `needs_base`).
4. Prior art [A5,K8,K10]: my-pi `herdr-app/mods/github-prs/merge.js:66-145` `mergeChain` (walks PR targets up; stops default/missing/ambiguous/cycle/8 deep); used by `main.js:114`.
5. Prior art [A6]: tstack CI: `src/domain/ci-babysitter.ts`, `src/application/coordinator/ci-watch.ts`, `team-runs/signals/ci-outcome.ts`, `ci_fix_dispatches` in `src/infrastructure/event-journal.ts`.
6. Prior art [K7]: tstack `src/cli/journal-export.ts` (NDJSON export) -> aiNho `tstack_events` (ADR 0007, append-only sync).
7. Consumers outside [K10,K3]: aiNho (would import), tstack (dispatch, CI), pi-selftools (verbs for the no-bash durable Pi), herdr `github-prs` mod (UI), aiLau (`F:/MyWork/aiLau`, Stage 4 host). All `would change` later; none read a kitchen today.
8. Prior art [A6 notices]: an aiNho trial script (deleted 2026-11-22; rules and numbers kept in the vault note, Build order step 6): pushed-only branches, merged-elsewhere = done, quiet round 2.9-3.0 s per repo, round with fetch 6-13 s.
9. Reality [K4,K6]: two machines (home `DESKTOP-LJB4PL8`, work laptop); work: outbound only, no inbound port, Node 22, npm feed pinned to Azure Artifacts (plan P1).
10. Reality [K11]: work repos listed as `github.com/Aspia-MyBusiness/*` in my-home AGENTS.md; pi-selftools PBI tools target that org. `gh` on home is signed in to an account without access to `thonghuynh1/tstack`.
11. Unknown [K1,K2]: no workspace/chat integration exists in any repo; who the other users are and which chat they use is unknown.
