---
repo: C:/Hackathon/tkitchen
slice: 1
parent_tickets: [01-board-and-card-chat]
covers_decisions: [D7, D12, D13, D15]
status: open
labels: [ready-for-agent]
---

## Parent

- Wayfinder map: `.scratch/waiter-board/map.md`
- Slice: 1
- Originating ticket & slice promise: `.scratch/waiter-board/wayfinder/01-board-and-card-chat.md#slice-1--board-and-card-chat`

## What to build

Add GitHub OAuth sign-in, session cookies, host-owner recognition, and `--public-url` support to `tkitchen board` backed by `~/.tkitchen/board.db` (leaving `~/.tkitchen/kitchen.db` untouched). Covers **D7**, **D12**, **D13**, **D15**, and **INV-001** (owner identification half).

## Implementation map

### Accepted decisions & contracts (carry verbatim)

- **D7 (GitHub sign-in)**: A person's canonical identity is `UserId = "github:<numeric id>"` (never keyed by mutable GitHub login; `login` is stored and displayed).
- **D12 (`--public-url`)**: `tkitchen board [--port <n>] [--host <addr>] [--public-url <url>]` stays tunnel-agnostic and listens locally (`127.0.0.1:<port>`). `publicUrl` defaults to the local bind URL (`http://<host>:<port>`). GitHub OAuth `redirect_uri` (`<publicUrl>/v1/auth/github/callback`), future invite links (`<publicUrl>/invite/<token>`), and the session cookie's `Secure` flag (`true` iff `publicUrl` starts with `https://`) all derive from `publicUrl`.
- **D13 (Single host owner)**: Host owner is pinned via config/env (`TKITCHEN_BOARD_OWNER_GITHUB_ID`, normalized to `github:<numeric id>`). `GET /v1/me` returns `{ authenticated: true, user: { id, login, isOwner } }` when signed in, or `401` `{ ok: false, error: "unauthorized" }` when unauthenticated.
- **D15 (Separate `board.db`)**: Board persistence lives in `join(kitchenHome(), "board.db")` (`node:sqlite`, WAL mode, `PRAGMA foreign_keys = ON`). `modules/triggers` and `kitchen.db` are never modified.
- **Accepted input surface**:
  - CLI: `tkitchen board [--port <n>] [--host <addr>] [--public-url <url>]`
  - HTTP:
    - `GET /v1/auth/github?returnTo=<path>` → `302` redirect to GitHub OAuth authorize URL with CSRF `state` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` if `https://`) and `redirect_uri = <publicUrl>/v1/auth/github/callback`. Reject non-relative `returnTo` (must start with `/` and not `//`, else default `/`).
    - `GET /v1/auth/github/callback?code=...&state=...` → verifies `state` cookie matches query `state` (400 on mismatch), exchanges `code` via `GitHubOAuthPort`, upserts user in `board.db`, creates session, sets session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` if `https://`), redirects `302` to saved `returnTo` (default `/`).
    - `POST /v1/auth/logout` → deletes session, clears session cookie, returns `200 { ok: true }`.
    - `GET /v1/me` → returns `200 { ok: true, user: { id, login, isOwner } }` or `401`.
    - `GET /v1/health` → unchanged `200 { ok: true }`.

### Deterministic seams & module rules (`docs/MODULES.md`)

- Create `modules/identities/`:
  - `lib/contract.ts`: branded `UserId` (`github:<id>`), branded `SessionId`, `IdentityUser`, `SessionRecord`, `IdentityStore` port, `GitHubOAuthPort` (`authorizeUrl`, `exchangeCode`).
  - `lib/`: pure auth/session/owner/returnTo logic using `Clock`, `Random`, `Ids` from `modules/platform/index.ts` (never raw `Date.now()`, `new Date()`, `Math.random()`, `randomUUID()`).
  - `lib/adapters/`: `SqliteIdentityStore` (`board.db` tables `users`, `sessions`) and `LiveGitHubOAuth` (`fetch` against GitHub OAuth/API).
  - `index.ts` (pure exports only), `adapters.ts` (Node exports), `web.ts` (browser-safe DTOs/types, no Node imports).
  - `tests/`: unit tests covering state mismatch, open-redirect rejection, owner matching, and `SqliteIdentityStore`.
- Export `modules/identities` from root `index.ts`.
- Obey `docs/MODULES.md`: no `as` casts (`design/no-unsafe-as`), branded IDs (`design/branded-ids`), no `CONTEXT.md` `_Avoid_` names (`design/context-terms`), max 800 lines/file.

### Callers of changed symbols (all verified by `git grep`)

- `modules/cli/lib/parse.ts` (`parseBoard`, `USAGE`): **required edit** — add `--public-url <url>` validation (must be valid `http:` or `https:` URL; strip trailing slash).
- `modules/cli/lib/contract.ts` (`ParsedCommand` board variant): **required edit** — add `publicUrl: string | undefined`.
- `modules/cli/lib/adapters/run.ts` (`runBoard`): **required edit** — read `--public-url` / `TKITCHEN_BOARD_PUBLIC_URL`, `TKITCHEN_BOARD_OWNER_GITHUB_ID`, `TKITCHEN_GITHUB_CLIENT_ID`, `TKITCHEN_GITHUB_CLIENT_SECRET`, construct `SqliteIdentityStore(join(kitchenHome(), "board.db"))` + `LiveGitHubOAuth`, pass to `startBoardServer`.
- `modules/board-http/lib/contract.ts` (`BoardServerOptions`): **required edit** — add optional `publicUrl`, `identities` wiring (keeping `health.test.ts` working cleanly).
- `modules/board-http/lib/adapters/server.ts` (`startBoardServer`, `respond`): **required edit** — route `/v1/auth/*` and `/v1/me`, support `POST` method, derive `Secure` cookie flag from `publicUrl`.
- `modules/board-http/tests/health.test.ts`: **unchanged — reason**: `BoardServerOptions` new fields are optional or defaulted for health-only server startup, preserving existing `/v1/health` contract.
- `index.ts`: **required edit** — export `modules/identities` entries.

### Mechanics left to implementer

- Exact SQLite column names/types in `users` and `sessions`, session token byte length/encoding (via `Random`/`Ids`), cookie name, session TTL, and exact env var fallback behavior when OAuth env vars are absent in health-only mode.

## Acceptance criteria

- [ ] `parseBoard` accepts `--public-url https://board.example.test`, normalizes trailing slash, and rejects non-http(s) URLs with exit code 2
  - Run: `npx vitest run modules/cli/tests/`
  - Test: `planned` → `modules/cli/tests/parse-board.test.ts` → `parses --public-url and rejects invalid URLs`
  - Expected: `--public-url https://board.example.test/` parses to `publicUrl: "https://board.example.test"`; `--public-url ftp://bad` returns `{ ok: false }`.
  - Fails when: `--public-url` is ignored or invalid schemes are accepted.

- [ ] GitHub OAuth flow via injected `GitHubOAuthPort` signs in a user, keys them as `github:<numeric id>`, sets `Secure` cookie iff `publicUrl` is `https://`, and sets `isOwner` strictly against `ownerGithubId`
  - Run: `npx vitest run modules/board-http/tests/auth.test.ts`
  - Test: `planned` → `modules/board-http/tests/auth.test.ts` → `completes OAuth callback, sets Secure cookie for https publicUrl, and distinguishes owner from non-owner`
  - Expected: `GET /v1/auth/github` redirects to `<publicUrl>/v1/auth/github/callback`; callback with matching state sets `HttpOnly; SameSite=Lax; Secure` cookie; `GET /v1/me` returns `{ ok: true, user: { id: "github:42", login: "owner", isOwner: true } }` for owner and `isOwner: false` for `"github:99"`.
  - Fails when: cookie omits `Secure` on `https://`, `UserId` keys by login instead of numeric id, or non-owner gets `isOwner: true`.

- [ ] OAuth callback rejects mismatched CSRF `state` with 400 and no session created; open redirect `returnTo=//evil.test` is normalized to `/`
  - Run: `npx vitest run modules/board-http/tests/auth.test.ts`
  - Test: `planned` → `modules/board-http/tests/auth.test.ts` → `rejects bad OAuth state without creating a session and sanitizes returnTo`
  - Expected: `400` response, zero rows inserted in `sessions`, and `//evil.test` redirects to `/`.
  - Fails when: mismatched state creates a session or external redirect URL is followed.

- [ ] `POST /v1/auth/logout` invalidates the session in `board.db` so subsequent `GET /v1/me` returns `401`, and `kitchen.db` is never created or modified
  - Run: `npx vitest run modules/board-http/tests/auth.test.ts`
  - Test: `planned` → `modules/board-http/tests/auth.test.ts` → `logout invalidates session and never touches kitchen.db`
  - Expected: `GET /v1/me` returns `401` after logout; `kitchen.db` does not exist in the isolated `TKITCHEN_HOME` dir while `board.db` does.
  - Fails when: session remains valid after logout or `kitchen.db` is opened.

- [ ] Full repo verification passes with zero regressions
  - Run: `npm run verify`
  - Test: repo gate
  - Expected: exit 0 (`format:check`, `lint`, `lint:guard`, `typecheck`, `seams`, `verify:structure`, `test`, `test:sim`, `build:web`).
  - Fails when: any lint ratchet, seam, structure, type, or test check fails.

## Blocked by

None - can start immediately.
