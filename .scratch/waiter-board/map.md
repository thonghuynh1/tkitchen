# Waiter board

## Destination

A hosted kanban board where each card is a Slack-style thread: people sign in with GitHub, the owner invites others by link and can remove them, members chat live, and a message with `@waiter` becomes one tkitchen Trigger that reaches the owner's machine, where a bot reads the thread and replies in it. The way is clear when every ticket below is resolved and cut.

## Notes

- Grill ledger: [ledger.md](ledger.md) (decisions D1–D7); evidence: [grounding.md](grounding.md). Verification profile: model+dst.
- Lives in tkitchen's `.scratch/` until the new repo exists (D6), then moves with its ledger.
- Answers tkitchen K1 (the workspace). Words follow tkitchen `CONTEXT.md`: a ping is a **Trigger**, a card is a **Thread** of the new kind `board:<card>`.
- Skills: `/trek` walks this map one ticket, one slice; `grill-with-docs` + `domain-modeling` for grilling tickets.
- Durable Pi plan: `my-home/.scratch/durable-pi/plan.md`.

## Decisions so far

- [D1 Hosting](ledger.md): Cloudflare Worker + one Durable Object per card; bots dial out over `wss://` (designed fresh in ticket 02, no aiLau prior art).
- [D2 Users](ledger.md): personal projects first, not work colleagues.
- [D3 Who may ping](ledger.md): any member writes `@waiter`; only the owner's bot acts, on the owner's machine.
- [D4 Waiter v1](ledger.md): reads the thread and replies only.
- [D5 Columns](ledger.md): Todo / Doing / Done, moved by people only.
- [D6 Repo](ledger.md): a new repo, separate from tkitchen; name open.
- [D7 Sign-in](ledger.md): GitHub OAuth in the Worker; a person is `github:<numeric id>`.
- [K-cost](ledger.md): Durable Objects run on the Workers Free plan (SQLite-backed only).
- [How aiLau's cloud extension dials out](wayfinder/04-ailau-cloud-pattern.md): Current branch uses HTTPS snapshot backups, not a WebSocket mailbox; Worker internals are unverified.

## Slice outcomes

## Not yet specified

- Notifications when someone is mentioned or the waiter replies (e-mail, browser, none).
- The waiter doing real work: tstack dispatch, opening PRs, moving cards; when observe mode ends and who approves an action.
- Whether board threads become trail in aiNho (through the kitchen export, tkitchen K7).
- Which orchestrator answers in the end (aiLau, a durable Pi, a plain Pi), beyond v1's reply-only bot.

## Parked ideas

## Out of scope

- The aiNho viewer and the tstack companion UI (user, 2026-11-25).
- Work colleagues and work data in v1 (D2).
