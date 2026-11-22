# tkitchen

tkitchen (the kitchen, named to sit beside tstack) takes orders (Triggers) from many places (git, the forge, tstack, people in a shared workspace), routes each one to the stations that handle it, and records what each station did. It sits under the durable Pi described in the vault note "Durable Pi orchestrating every branch" (working name there: the yard).

The kitchen's part of that plan is in `.scratch/tkitchen-v1/plan.md`; read it before designing or building anything here.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: `CONTEXT.md` at root + `docs/adr/`. See `docs/agents/domain.md`.
