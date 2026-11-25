# Grounding: waiter-board

## Background (2026-11-25)

1. Today (K-trigger, K-bot): no workspace producer exists. tkitchen v1 writes only git Triggers: `baseMovedTrigger` in `src/domain/trigger/trigger.ts` → `event` table in `src/infrastructure/sqlite/store.ts` → notice station (`src/application/notices.ts`). Thread kinds in `CONTEXT.md` are only `git:<repo>:<branch>` and `<forge>:<repo>:<pr>`; a card thread `board:<card>` is missing.
2. Trigger shape already fits a person's ping (K-trigger, K-context): `Trigger { id, source, threads, actor, human, addressed, text, channel, url, machine, meta }` (`trigger.ts`); plan Direction 2026-11-06: human note = `human: true, addressed: direct`, all `text` untrusted.
3. Prior art (D1, K-bot): **none.** aiLau `cloud` extension (`feature/init` `a87a1a0`) is HTTPS snapshot backup with a shared bearer token, retry 1 s/2 s, no WebSocket, no offline queue (ticket 04 Answer). The durable-pi plan's "Worker + Durable Object mailbox over `wss://`" was a plan, never built.
4. Prior art (K-context): dsh-superagent Threads + Inline & Spill (plan Direction 2026-11-06): ids + 160-char previews, full text behind a recall verb.
5. Prior art (K-offline): tkitchen Disposition (`disposition` table) records what a station did per Trigger per Thread; hand-back and observe mode rules in `.scratch/tkitchen-v1/plan.md` "Rules for every station".
6. Consumers outside this code: aiNho imports kitchen records later (tkitchen K7) — would change if board Triggers land in a local kitchen; aiNho viewer and tstack companion UI — unaffected (user).
7. Reality: no Cloudflare tooling on this laptop (`wrangler` not on PATH); users = personal projects (D2); size unknown.
