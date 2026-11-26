# Waiter board

## Destination

A local-hosted kanban board, run on whichever machine hosts it and exposed at a URL while it runs, where each card is a Slack-style thread: people sign in with GitHub, the owner invites others by link and can remove them, members chat live, and a message with `@waiter` becomes one tkitchen Trigger in the host's own tkitchen, where a bot on that host reads the thread and replies in it. The way is clear when every ticket below is resolved and cut.

## Notes

- Grill ledger: [ledger.md](ledger.md) (decisions D1–D7); evidence: [grounding.md](grounding.md). Verification profile: model+dst.
- Built inside tkitchen (D11). The restructure that comes first: [kitchen-modules plan](../kitchen-modules/overview.md). Its skeleton is live (phases 1 to 10, 2026-11-26): the web app in `src/`, `tkitchen board` serving it with `/v1/health` through `modules/board-http/`. Tickets 01 to 03 now grow modules (`identities`, `cards`, `chat`, `live`, `waiter`) beside `board-http`, and web screens reach each module only through its `web.ts`.
- Answers tkitchen K1 (the workspace). Words follow tkitchen `CONTEXT.md`: a ping is a **Trigger**, a card is a **Thread** of the new kind `board:<card>`.
- Skills: `/trek` walks this map one ticket, one slice; `grill-with-docs` + `domain-modeling` for grilling tickets.
- Durable Pi plan: `my-home/.scratch/durable-pi/plan.md`.

## Decisions so far

- [D1 Hosting](ledger.md): local and portable: the board and the waiter run on the same host (laptop or home PC), exposed at a URL while running; GitHub sign-in decides membership. Replaced Cloudflare hosting.
- [D2 Users](ledger.md): personal projects first, not work colleagues.
- [D3 Who may ping](ledger.md): any member writes `@waiter`; only the owner's bot acts, on the owner's machine.
- [D4 Waiter v1](ledger.md): reads the thread and replies only.
- [D5 Columns](ledger.md): Todo / Doing / Done, moved by people only.
- [D11 Repo](ledger.md): built inside tkitchen, after restructuring it into vertical modules (supersedes D6).
- [D7 Sign-in](ledger.md): GitHub OAuth in the Worker; a person is `github:<numeric id>`.
- [D8 Board per host](ledger.md): each host has its own board and store; nothing syncs between hosts.
- [D9 Borrow cookout's patterns](ledger.md): mattpocock/cookout has no license, so we rewrite its patterns (SSE with revocation, webhook delivery with retries, module seams, lint ratchet) on our own stack, not fork it.
- [D10 UI](ledger.md): our own UI, built with shadcn/ui.
- [How aiLau's cloud extension dials out](wayfinder/04-ailau-cloud-pattern.md): Current branch uses HTTPS snapshot backups, not a WebSocket mailbox; Worker internals are unverified.

## Slice outcomes

## Not yet specified

- Notifications when someone is mentioned or the waiter replies (e-mail, browser, none).
- The waiter doing real work: tstack dispatch, opening PRs, moving cards; when observe mode ends and who approves an action.
- Whether board threads become trail in aiNho (through the kitchen export, tkitchen K7).
- One board that moves between hosts (store over R2 + a host lock), instead of one board per host (D8).
- Hosting the board in the cloud (Cloudflare Worker + Durable Objects) so it is up when no host is on; the earlier D1.
- Which orchestrator answers in the end (aiLau, a durable Pi, a plain Pi), beyond v1's reply-only bot.

## Parked ideas

## Out of scope

- The aiNho viewer and the tstack companion UI (user, 2026-11-25).
- Work colleagues and work data in v1 (D2).
