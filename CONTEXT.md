# tkitchen

The kitchen takes orders from many producers, routes each to the stations that handle it, and records what each station did. One kitchen runs per machine; v1 watches git only.

## Language

### Orders and records

**Trigger**:
One immutable record of something that happened, written once by a producer and identified by its source identity plus version.
_Avoid_: event (in prose; `event` is the table name), message, order (except in plain words for a person's request)

**Thread**:
A named conversation a Trigger belongs to, either `git:<repo>:<branch>` or `<forge>:<repo>:<pr>`.
_Avoid_: topic, channel

**Disposition**:
One station's recorded decision about one Trigger on one Thread, kept only on the machine that made it.
_Avoid_: result, handling, ack

**Producer**:
A source that writes Triggers (v1: the git producer).
_Avoid_: source plugin, feed

**Station**:
A consumer that reads Triggers and writes Dispositions (v1: the notice station).
_Avoid_: dish, handler, worker (a worker is a tstack or Pi agent)

**Round**:
One producer pass over one repo: read the remote, read open PRs, record what moved.
_Avoid_: poll, tick, sync

### Branches

**Watched branch**:
A branch pushed to the remote and not merged into its base or into another pushed branch.
_Avoid_: tracked branch, active branch

**Base**:
The branch a watched branch was cut from and merges back into, found from evidence and never guessed.
_Avoid_: parent, upstream, target (target is a PR's field)

**Base evidence**:
The rung that settled a Base: explicit override, open PR target, creation reflog, or creation reflog tip.
_Avoid_: heuristic, guess

**Base moved**:
The Trigger written when a Base that has children gets a new head.
_Avoid_: base changed, upstream update

**Notice**:
A current, open statement that a watched branch is behind its Base, has no Base (`needs_base`), or has conflicting evidence (`ambiguous`).
_Avoid_: alert, notification, warning

## Relationships

- A **Producer** writes **Triggers** during a **Round**.
- A **Trigger** belongs to one or more **Threads**; a **Base moved** Trigger has one Thread per child branch.
- A **Station** writes at most one **Disposition** per **Trigger** and **Thread**.
- Each **Watched branch** has exactly one **Base**, or a **Notice** of `needs_base` or `ambiguous`.
- A **Notice** closes by itself when its branch catches up or stops being a **Watched branch**.

## Example dialogue

> **Dev:** "C got a push. Does every branch on the repo get a **Trigger**?"
> **Domain expert:** "No. One **Base moved** **Trigger**, with a **Thread** for B and one for D, because only they have C as their **Base**."
> **Dev:** "And if B merges C later, do we need another **Trigger** to close B's **Notice**?"
> **Domain expert:** "No. The next **Round** sees B caught up and the **Notice** closes. **Triggers** are history; **Notices** are what is open now."

## Flagged ambiguities

- The vault plan called the kitchen "the yard" until 2026-11-22: resolved, it is **tkitchen**, "the kitchen" in plain words.
- "event" names both the concept and the table: resolved, the concept is **Trigger**, the table stays `event`.
- "dish" (ledger A6) meant a station's job: resolved, use **Station**.
