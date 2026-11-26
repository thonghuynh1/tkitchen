---
repo: C:/Hackathon/tkitchen
slice: 1
parent_tickets: [01-board-and-card-chat]
covers_decisions: [D13, D14, D15, D16, D17, D18]
status: open
labels: [ready-for-agent]
---

## Parent

- Wayfinder map: `.scratch/waiter-board/map.md`
- Slice: 1
- Originating ticket & slice promise: `.scratch/waiter-board/wayfinder/01-board-and-card-chat.md#slice-1--board-and-card-chat`

## What to build

Build the deterministic simulation testing (DST) harness in `sim/board.sim.ts` exercising the real pure logic of `modules/identities`, `modules/cards`, `modules/chat`, and `modules/live` across seeded fault schedules, asserting `INV-001`..`INV-004` and `PRG-001` after every step, and exporting `dst-trace.jsonl` to prove conformance against `.scratch/waiter-board/model/model.mjs`.

## Implementation map

### Accepted invariants & model contract (carry verbatim)

- **Model**: `.scratch/waiter-board/model/model.mjs` (370 states, 4 INV, 1 PRG, 5/5 mutants killed).
- **Invariants checked after EVERY simulated step**:
  - `INV-001` (D13): Only the host owner may create cards; non-members may never hold an open live stream for a card.
  - `INV-002` (D14): A removed member can never rejoin using an invite link created before or at their removal.
  - `INV-003` (D16): A non-member never receives messages posted after removal (neither via SSE nor via catch-up).
  - `INV-004` (D17): A soft-deleted (archived) card has no active invite, no non-owner members, and no open live streams.
  - `PRG-001` (D16): An active member who missed messages during a disconnect can always catch up (or be removed/archived).
- **Deterministic seams**:
  - Reuse `sim/world/clock.ts`, `sim/world/rng.ts`, and `modules/platform/index.ts` (`Clock`, `Random`, `Ids`).
  - Add in-memory deterministic doubles under `sim/doubles/` implementing `IdentityStore`, `CardStore`, `ChatStore`, and `LiveHub` (supporting SSE drop, disconnect, duplicate redeem, and restart by dropping in-memory `LiveHub` while keeping durable store state).
- **Fault matrix**:
  1. SSE disconnect/drop mid-chat while owner posts messages, followed by `?after=<seq>` catch-up,
  2. Duplicate invite redeem by same user and concurrent redeem by second user,
  3. Interleaved `removeMember` vs `postMessage`,
  4. Interleaved `closeSharing` vs `redeemInvite` with stale token,
  5. `archiveCard` while multiple non-owner SSE streams are open,
  6. Server restart (clear in-memory `LiveHub`, keep durable store, verify reconnect catch-up and revoked-invite durability).
- **Seed & trace env contract**:
  - `DST_SEED=<n>`: replay one exact seed.
  - `DST_SEEDS=<count>`: sweep `count` seeds (default `200` in `npm run test:sim`).
  - `DST_TRACE_OUT=<path>`: write abstract JSONL `{ action, state }` entries matching `.scratch/waiter-board/model/model.mjs` action names and state projection so `node C:/Hackathon/hackathon-grill-me/dist/formal/cli.js .scratch/waiter-board/model/model.mjs --trace <path>` validates conformance.

### Blocking-edge wiring (from Issue 03)

- **Producer**: `03-card-chat-and-live-sse.md` (and `01`/`02`) exports the pure operations and contracts from `modules/identities/index.ts`, `modules/cards/index.ts`, `modules/chat/index.ts`, and `modules/live/index.ts`.
- **Consumer**: `sim/board.sim.ts` imports only module `index.ts` entries (obeying `.dependency-cruiser.cjs`) and drives the real code through deterministic doubles.

### Callers of changed symbols

- `vitest.sim.config.ts`: **unchanged — reason**: already discovers `sim/**/*.sim.ts` (verify `sim/board.sim.ts` is picked up by `npm run test:sim`).

### Mechanics left to implementer

- Internal file split under `sim/doubles/` and `sim/oracles/`, exact PRNG step distribution weights.

## Acceptance criteria

- [ ] Seeded DST sweep runs 200 seeds over the real pure board modules and passes `INV-001`..`INV-004` and `PRG-001` after every step, with deterministic single-seed replay via `DST_SEED`
  - Run: `DST_SEEDS=200 npm run test:sim` and `DST_SEED=42 npm run test:sim`
  - Test: `planned` → `sim/board.sim.ts` → `board DST sweep holds INV-001..INV-004 and PRG-001 across fault schedules`
  - Expected: exit 0; running `DST_SEED=42` twice produces identical step count and final state; all 6 fault-matrix scenarios execute.
  - Fails when: any invariant fails, replay is nondeterministic, or a fault category is never exercised.

- [ ] Exported `dst-trace.jsonl` conforms 100% to `.scratch/waiter-board/model/model.mjs`
  - Run: `DST_SEED=1 DST_TRACE_OUT=.scratch/waiter-board/model/dst-trace.jsonl npx vitest run --config vitest.sim.config.ts sim/board.sim.ts && node C:/Hackathon/hackathon-grill-me/dist/formal/cli.js .scratch/waiter-board/model/model.mjs --trace .scratch/waiter-board/model/dst-trace.jsonl`
  - Test: `planned` → `sim/board.sim.ts` + formal trace conformance CLI
  - Expected: `cli.js --trace` exits 0 with 0 illegal transitions and 0 invariant violations.
  - Fails when: trace actions/states drift from `model.mjs` or real code takes an illegal transition.

- [ ] Scratch-break anti-vacuity check: temporarily breaking each invariant guard in product code causes `sim/board.sim.ts` to fail and print a reproducible `DST_SEED` (reverted before commit)
  - Run: temporary scratch break of `INV-001`..`INV-004` + `DST_SEEDS=50 npx vitest run --config vitest.sim.config.ts sim/board.sim.ts`, then revert and rerun `npm run verify`
  - Test: `planned` → `sim/board.sim.ts`
  - Expected: each scratch break fails with the violated `INV-###` and seed; after reverting, `npm run verify` exits 0.
  - Fails when: a broken guard passes the sweep undetected.

## Blocked by

- Local: `03-card-chat-and-live-sse.md`
