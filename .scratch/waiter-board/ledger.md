# Ledger: waiter-board

Requirement (user, 2026-11-25): a shared place where people chat and ping a bot. A kanban board; each card is a Slack-style thread. Clicking a card opens its chat. A card has one or more members; the owner shares an invite link, invitees see the card on their own board, and the owner can remove members. Plain chat triggers nothing; only a message with `@waiter` sends one Trigger to an orchestrator bot (aiLau or a durable Pi, undecided), which reads the thread's context and acts. Not part of the aiNho viewer or the tstack companion UI.

Status: charted into map.md (2026-11-25, user chose a map).

Loaded by pick-flow -> grill-with-docs, 2026-11-25, from my-home session (durable Pi plan, `my-home/.scratch/durable-pi/plan.md`). Answers tkitchen K1 (the workspace). Lives here until the new repo exists, then moves.

Verification profile: model+dst. Reason: membership changes (invite, remove) must cut access at once, an `@waiter` must make exactly one Trigger across reconnects and retries, and the bot may be offline when it is pinged.

## Decisions

- D1 accepted (user, 2026-11-25): hosted on Cloudflare: a Worker plus one Durable Object per card; bots dial out over `wss://` (aiLau `cloud` extension pattern). Alternative: home aiLau behind the existing tunnel (down when the home PC is off).
- D2 accepted (user, 2026-11-25): v1 users are people on personal projects, not work colleagues. Work data on personal infrastructure is out until cleared at work.
- D3 accepted (user, 2026-11-25): any member may write `@waiter`; only the card owner's bot acts, on the owner's machine.
- D4 accepted (user, 2026-11-25): v1 waiter reads the thread and replies only (observe mode). Real actions (tstack dispatch, PRs) come later.
- D5 accepted (user, 2026-11-25): fixed columns Todo / Doing / Done; only people move cards in v1.
- D6 accepted (user, 2026-11-25): a new repo, separate from tkitchen. Name open (K-name).

## Open

- D7 accepted (user, 2026-11-25; was K-id): sign-in with GitHub, built in the Worker (GitHub OAuth app; client id/secret as Worker secrets; a session cookie). Chosen over Cloudflare Access (no seat limit, no Zero Trust setup) and over link-only (no proven identity). Default recorded: a person is keyed by GitHub's numeric user id, not the login (logins can be renamed); the login is shown. Trigger `actor` = `github:<id>`. Left to the implementer: where sessions live (signed cookie or a store), cookie lifetime.
  Flow: open invite link → "Sign in with GitHub" → OAuth callback → session cookie → card checks membership → join.
- K-invite open, waits-on: user. Invite link: one use or many, expiry, and that removing a member cuts their access at once (open sockets too).
- K-bot open, waits-on: repo. What connects the owner's machine to the board: a new small connector, a tkitchen producer, or aiLau's cloud extension.
- K-trigger open, waits-on: repo. Where the `@waiter` Trigger is first written (the card's Durable Object or the owner's local kitchen) and how it reaches the bot exactly once.
- K-context open, waits-on: user. What thread context the bot gets (whole thread or since the last `@waiter`, a cap, untrusted text as id + summary).
- K-reply open, waits-on: user. How the bot answers (as a `waiter` member in the thread; one final message or streamed).
- K-offline open, waits-on: user. What happens when the owner's bot is offline at ping time (queue and show "waiting", or refuse).
- K-machine open, waits-on: user. Which of the owner's machines takes the ping when both are online (tkitchen K6).
- K-boardstore open, waits-on: repo. Where a user's board (list of cards) lives: a Durable Object per user, or D1.
- K-retention open, waits-on: user. How long threads are kept and who can delete a card.
- K-cost accepted (repo, 2026-11-25): Durable Objects run on the Workers Free plan, SQLite-backed only; over a daily free limit, further operations of that type fail until 00:00 UTC (developers.cloudflare.com/durable-objects/platform/pricing). Cloudflare Access consumes one seat per signed-in person; once seats run out, new people are blocked (cloudflare-one seat-management). Free seat count not confirmed in docs read.
- K-name open, waits-on: user. Repo name.

deliveries: 3 (board + multi-user card chat; `@waiter` Trigger + owner's bot connection; bot reads and replies)
modules: 2 (new repo; tkitchen glossary/Thread kind, maybe a station)
contract: y (new Thread kind `board:<card>`, Trigger source `board`, wire protocol between board and bot)
Size check: open=12 closed=6 waits=[] deliveries=3 modules=2 contract=y trend==
Size check: open=11 closed=7 waits=[] deliveries=3 modules=2 contract=y trend=-
Size check: open=10 closed=8 waits=[] deliveries=3 modules=2 contract=y trend=-
