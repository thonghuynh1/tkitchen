---
repo: C:/Hackathon/tkitchen
slice: 1
parent_tickets: [01-board-and-card-chat]
covers_decisions: [D5, D7, D9, D10, D13, D14, D16, D17, D18]
status: open
labels: [ready-for-agent]
---

## Parent

- Wayfinder map: `.scratch/waiter-board/map.md`
- Slice: 1
- Originating ticket & slice promise: `.scratch/waiter-board/wayfinder/01-board-and-card-chat.md#slice-1--board-and-card-chat`

## What to build

Build the React 19 + shadcn/ui waiter board web app in `src/` (importing module types/clients **only** through `modules/*/web.ts`, per `docs/MODULES.md`) so two GitHub users can sign in, accept an invite link, view and move cards across `Todo / Doing / Done`, chat live in 1-level threads with a `@waiter` mention picker, and see cards disappear / open chat stop the moment the owner removes them, closes sharing, or deletes (archives) a card.

## Implementation map

### Accepted decisions & contracts (carry verbatim)

- **D10 (UI stack)**: React 19 + Tailwind v4 + shadcn/ui in `src/`; `@radix-ui/*` imported only from `src/components/ui/`.
- **`docs/MODULES.md` browser seam rule**: Files under `src/` and any module `web.ts` import **no** Node built-in, and `src/` reaches modules **only** through `modules/<module>/web.ts` (never `index.ts` or `adapters.ts`). Verified by `npm run seams` and `npm run typecheck`.
- **User flows in `src/`**:
  1. **Unauthenticated**: calls `GET /v1/me` → `401` → renders "Sign in with GitHub" button linking to `/v1/auth/github?returnTo=<currentPath>`.
  2. **Invite landing (`/invite/<token>`)**: if unauthenticated, redirects through `/v1/auth/github?returnTo=/invite/<token>`; once signed in, calls `POST /v1/invites/:token/redeem` → on `200` navigates to board with that card open; on `410` shows clear "This invite link is no longer valid" state.
  3. **Board (`Todo / Doing / Done`)**:
     - Header shows signed-in GitHub login + Sign out (`POST /v1/auth/logout`).
     - Owner sees **"New card"** button (`POST /v1/cards`), plus on each card: **"Copy invite link"** (`POST /v1/cards/:id/invite`), member list with **"Remove"** (`DELETE /v1/cards/:id/members/:userId`), **"Close sharing"** (`POST /v1/cards/:id/close-sharing`), and **"Delete card"** with confirmation (`DELETE /v1/cards/:id`).
     - Invitees see only cards they belong to (no "New card", no invite/remove/delete controls); strangers with 0 cards see `"No cards yet — ask the owner for an invite."`.
     - Any card member or owner can move a card between `Todo`, `Doing`, and `Done` (`PATCH /v1/cards/:id/column`).
  4. **Card chat view**:
     - Displays messages ordered by `seq`, with 1-level replies grouped under their parent message and a "Reply" button on any message (submitting `parentId`).
     - Composer triggers a `@` mention picker offering `@waiter` (inserts `@waiter ` on Enter/Tab/click) per **D18**.
     - Live updates via `EventSource("/v1/stream")`: applies `card_created`, `card_moved`, `message_created`; on `card_removed`, immediately removes the card from board state and closes the chat view with a clear notice if that card was open.
     - On `EventSource` reconnect (`onopen` after disconnect), calls `GET /v1/cards` and `GET /v1/cards/:id/messages?after=<lastSeq>` to catch up missed messages cleanly.

### Blocking-edge wiring (from Issues 01–03)

- **Producers**: `01-identities-and-oauth.md`, `02-cards-invites-and-archive.md`, `03-card-chat-and-live-sse.md` provide `modules/identities/web.ts`, `modules/cards/web.ts`, `modules/chat/web.ts`, `modules/live/web.ts`, and all `/v1/*` HTTP/SSE routes in `modules/board-http/`.
- **Consumer**: `src/` imports DTOs/parsers only from `modules/*/web.ts` and builds into `dist/web` via `npm run build:web` (served by `startBoardServer`).

### Callers of changed symbols

- `src/app.tsx`: **required edit** — replace static empty columns with the authenticated board, invite flow, and card chat UI.
- `src/main.tsx`: **unchanged — reason**: mounts `<App />`.
- `.verification-skills/verify-tkitchen/scripts/journeys/board.sh`: **unchanged — reason**: still verifies `tkitchen board` serves `dist/web` and `GET /v1/health`.

### Mechanics left to implementer

- Component split under `src/`, shadcn primitive additions under `src/components/ui/`, mention popover keyboard navigation details, and visual polish.

## Acceptance criteria

- [ ] `src/` builds cleanly into `dist/web` and passes all browser-seam and type rules (`modules/*/web.ts` only, zero Node imports)
  - Run: `npm run typecheck && npm run seams && npm run build:web`
  - Test: repo checks
  - Expected: exit 0; `dist/web/index.html` and JS/CSS assets are emitted with zero dependency-cruiser violations.
  - Fails when: `src/` imports a module `index.ts`/`adapters.ts` or any `node:*` built-in, or TypeScript web check fails.

- [ ] Two-user end-to-end headless browser/UI flow against a real local `startBoardServer` (with injected test `GitHubOAuthPort`) proves sign-in, invite redeem, live chat, `@waiter` mention insertion, column move, and instant removal
  - Run: `npx vitest run modules/board-http/tests/web-e2e.test.ts` (or headless Playwright script wired as a vitest test)
  - Test: `planned` → `modules/board-http/tests/web-e2e.test.ts` → `two users sign in, join by invite link, chat live with @waiter picker, and removal clears board and stops chat`
  - Expected: Owner creates Card 1 and copies invite link; Alice opens invite link, joins, sees Card 1, inserts `@waiter ` via `@` picker and sends message; Owner sees message live; Owner removes Alice (or clicks Close sharing) → Card 1 disappears from Alice's board and her open chat closes immediately without refresh.
  - Fails when: invite link fails, live SSE does not update both clients, `@` picker doesn't insert `@waiter`, or removed user still sees the card/chat.

- [ ] Existing `board.sh` journey and full `npm run verify` pass
  - Run: `npm run verify && bash .verification-skills/verify-tkitchen/scripts/journeys/board.sh`
  - Test: repo gate + `board.sh`
  - Expected: exit 0 and all `PASS` lines in `board.sh`.
  - Fails when: built web page breaks `/` or `/v1/health` or any repo check regresses.

## Blocked by

- Local: `03-card-chat-and-live-sse.md`

## Independent QA

- `verdict: fail` at `50e17ff1b3d9a3b35f92151fa70ca602e5c23ea0`.
- The build, browser seams, full gate, two checked-in Chromium tests, and six board CLI journey checks passed.
- An independent Chromium probe reproduced two blockers: the owner cannot immediately remove an idle new invitee from the existing board, and switching cards carries an unsent draft into the destination card where Send can publish it.
- [Evidence and replay](../../../.verification-evidence/verify-tkitchen/qa-05-50e17ff/review.md).

## Independent QA re-review

- `verdict: pass` at `4c99d537c753b26bcd0d90ba3d1c18cfcbff8d10`.
- Independent Chromium replay confirmed that a draft cannot cross card boundaries and that the owner can remove an idle new invitee without refreshing. The invitee's card disappeared and open chat closed with a notice.
- Browser build and seams, all three focused Chromium tests, the full repository gate, and all six board journey checks passed.
- [Re-review evidence and replay](../../../.verification-evidence/verify-tkitchen/qa-05-4c99d53/review.md).
