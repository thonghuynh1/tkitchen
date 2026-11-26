# Coverage Ledger — Slice 1 (Board and card chat)

- **Base**: `C:/Hackathon/tkitchen` @ `3bc6f97e7b43348967bc89b9525cceb8f9d935d4` (uncommitted planning/verification files: `.scratch/waiter-board/*`, `.verification-skills/verify-tkitchen/features/waiter-board.md`, `.verification-skills/verify-tkitchen/features/README.md`)
- **Originating ticket**: `.scratch/waiter-board/wayfinder/01-board-and-card-chat.md`
- **Verification profile**: `model+dst`
- **Cutting gate**: `ALLOW` (recorded in `.scratch/waiter-board/ledger.md`; 0 open contracts, 0 pending overlapping issues, Final model check PASS 370 states / 5/5 mutants killed)

## Baseline at Base (`3bc6f97e7b43348967bc89b9525cceb8f9d935d4`)

| Check | Working dir | Result at Base |
| --- | --- | --- |
| `npm run format:check` | `C:/Hackathon/tkitchen` | PASS (165 files) |
| `npm run lint` | `C:/Hackathon/tkitchen` | PASS (159 diagnostics, none above `lint-baseline.json`) |
| `npm run lint:guard` | `C:/Hackathon/tkitchen` | PASS |
| `npm run typecheck` | `C:/Hackathon/tkitchen` | PASS |
| `npm run seams` | `C:/Hackathon/tkitchen` | PASS (147 modules, 459 dependencies) |
| `npm run verify:structure` | `C:/Hackathon/tkitchen` | PASS (56 production files) |
| `npm test` / `npm run test:sim` | `C:/Hackathon/tkitchen` | Sandbox EPERM writing `node_modules/.vite-temp` in this planning session (verified in implementation session) |

## Obligation coverage (single owner per row)

| Obligation | Type | State | Owning issue | Proving criterion |
| --- | --- | --- | --- | --- |
| D7 GitHub OAuth sign-in & `UserId = github:<numeric id>` | Decision | covered | `01-identities-and-oauth.md` | AC2 (`modules/board-http/tests/auth.test.ts`) |
| D12 `--public-url` on `tkitchen board` (callback, invite origin, `Secure` cookie) | Decision | covered | `01-identities-and-oauth.md` | AC1 (`parse-board.test.ts`) & AC2 (`auth.test.ts`) |
| D13 Single host owner (`ownerGithubId`), non-owner `403` on writes | Decision | covered | `01-identities-and-oauth.md` (identity/isOwner) | AC2 (`auth.test.ts`) |
| D13 Owner-only card create/invite/remove/archive; invitee card visibility | Decision | covered | `02-cards-invites-and-archive.md` | AC1 (`cards.test.ts`) |
| D5 Fixed columns `Todo / Doing / Done`, moved by owner or card member | Decision | covered | `02-cards-invites-and-archive.md` | AC1 (`cards.test.ts`) |
| D14 Multi-use per-card invite link, individual kick revokes invite, Close sharing kicks all | Decision | covered | `02-cards-invites-and-archive.md` | AC2 & AC3 (`cards.test.ts`) |
| D15 Separate `~/.tkitchen/board.db` leaving `kitchen.db` untouched | Decision | covered | `01-identities-and-oauth.md` | AC4 (`auth.test.ts`) |
| D17 Soft-delete (`archived_at`) by owner only; hides card & revokes invites/members | Decision | covered | `02-cards-invites-and-archive.md` | AC3 (`cards.test.ts`) |
| D9 One-level threads (reply-to-reply attaches to parent) | Decision | covered | `03-card-chat-and-live-sse.md` | AC1 (`chat.test.ts`) |
| D9 / D16 Immediate SSE revocation on removal, Close sharing, and archive | Decision | covered | `03-card-chat-and-live-sse.md` | AC3 (`live-chat.test.ts`) |
| D16 Single per-user SSE stream `GET /v1/stream` + `?after=<seq>` catch-up | Decision | covered | `03-card-chat-and-live-sse.md` | AC2 (`live-chat.test.ts`) |
| D18 `@waiter` placeholder (`MessageId` + `parseMentionsWaiter`, no Trigger yet) | Decision | covered | `03-card-chat-and-live-sse.md` | AC1 & AC4 (`chat.test.ts`, `live-chat.test.ts`) |
| D18 `@` mention picker in composer inserting `@waiter ` | Decision | covered | `05-board-web-ui.md` | AC2 (`web-e2e.test.ts`) |
| D10 React 19 + shadcn/ui web app importing modules only via `web.ts` | Decision | covered | `05-board-web-ui.md` | AC1 & AC2 (`npm run seams`, `web-e2e.test.ts`) |
| `INV-001` Owner-only create; non-members never hold open SSE streams | Invariant | covered | `04-board-dst-and-model-conformance.md` | AC1 & AC3 (`sim/board.sim.ts`) |
| `INV-002` Removed member never rejoins with old invite link | Invariant | covered | `04-board-dst-and-model-conformance.md` | AC1 & AC3 (`sim/board.sim.ts`) |
| `INV-003` Non-member never receives post-removal messages (SSE or catch-up) | Invariant | covered | `04-board-dst-and-model-conformance.md` | AC1 & AC3 (`sim/board.sim.ts`) |
| `INV-004` Archived card has no active invite, non-owner members, or open streams | Invariant | covered | `04-board-dst-and-model-conformance.md` | AC1 & AC3 (`sim/board.sim.ts`) |
| `PRG-001` Active member catches up missed messages after disconnect | Progress | covered | `04-board-dst-and-model-conformance.md` | AC1 (`sim/board.sim.ts`) |
| Model ↔ code trace conformance (`dst-trace.jsonl` vs `model.mjs`) | Formal check | covered | `04-board-dst-and-model-conformance.md` | AC2 (`cli.js --trace`) |
| Edge: `tkitchen serve/round/notices/export` untouched (`kitchen.db` unmodified) | Edge | covered | `03-card-chat-and-live-sse.md` | AC4 (`live-chat.test.ts`) |
| Edge: restart durability of `board.db` messages & revoked invites | Edge | covered | `03-card-chat-and-live-sse.md` | AC4 (`live-chat.test.ts`) |
| Edge: real GitHub OAuth + Cloudflare Named Tunnel on home PC (`https://board.<domain>`) | Edge / HITL | HITL | `06-hitl-live-github-and-tunnel-smoke.md` | Manual two-browser smoke on home PC |
| Archive viewer / restore UI | Deferred | deferred/out of scope | — | Explicitly excluded in D17 (Slice 1 keeps rows in `board.db` only) |
| `@waiter` Trigger emission to `kitchen.db` & bot reply | Deferred | deferred/out of scope | — | Owned by Ticket 02 (`02-waiter-reaches-the-owner.md`) and Ticket 03 |

## Audit findings

- Checked every `D<n>` (D5, D7, D9, D10, D12–D18) for plausible wrong implementations (open redirect, state mismatch, non-owner create, single-use vs multi-use invite, stale invite replay after kick/Close sharing/archive, 2-level reply nesting, email/code-block `@waiter` false positive, SSE left open after removal, post-removal catch-up leak, `src/` importing `index.ts` instead of `web.ts`): every case has a dedicated falsifying AC.
- Checked all callers of `parseBoard`, `runBoard`, `startBoardServer`, `BoardServerOptions` (`git grep`): all accounted for in Issues 01–03.
- Checked "left to implementer" sections: contain only local mechanics (DDL column names, token encoding, heartbeat interval, UI styling).
- **Coverage gaps**: `None`.
