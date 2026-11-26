---
repo: C:/Hackathon/tkitchen
slice: 1
parent_tickets: [01-board-and-card-chat]
covers_decisions: [D1, D7, D12, D13, D14, D16, D17, D18]
status: open
labels: [ready-for-human]
---

## Parent

- Wayfinder map: `.scratch/waiter-board/map.md`
- Slice: 1
- Originating ticket & slice promise: `.scratch/waiter-board/wayfinder/01-board-and-card-chat.md#slice-1--board-and-card-chat`

## What to build

Human smoke verification of Slice 1 on the home PC behind the real Cloudflare Named Tunnel (`https://board.<domain>`, no Cloudflare Access policy in front) with a real GitHub OAuth App and two real GitHub accounts. Automated tests cannot prove real GitHub OAuth credentials, Cloudflare Tunnel HTTPS forwarding, or two-person browser UX over the public internet.

## Implementation map

- **Setup (one-time on home PC)**:
  1. In Cloudflare Zero Trust → *Networks → Tunnels*, route `board.<your-domain>` → `http://127.0.0.1:3000` (with **no** Cloudflare Access policy blocking friends).
  2. Create a GitHub OAuth App with Authorization callback URL = `https://board.<your-domain>/v1/auth/github/callback`.
  3. Set `TKITCHEN_BOARD_PUBLIC_URL=https://board.<your-domain>`, `TKITCHEN_BOARD_OWNER_GITHUB_ID=<your numeric GitHub id>`, `TKITCHEN_GITHUB_CLIENT_ID`, and `TKITCHEN_GITHUB_CLIENT_SECRET`.
- **Run**: `npm run build:web && tkitchen board --public-url https://board.<your-domain>`

## Acceptance criteria

- [ ] Two real GitHub users sign in over `https://board.<domain>`, join via invite link, move cards, chat live with `@waiter` autocomplete, and see instant revocation on removal / Close sharing
  - Run: Manual two-browser test (owner account + friend/secondary GitHub account) against `https://board.<your-domain>`
  - Test: HITL smoke
  - Expected:
    1. Owner signs in with GitHub, creates a card, and copies the `https://board.<your-domain>/invite/<token>` link.
    2. Second GitHub user opens the link, signs in with GitHub, sees the card on their board, chats live (including typing `@` to insert `@waiter `), and moves the card column.
    3. Owner removes the second user (or clicks **Close sharing**): the card vanishes from the second user's board and their open chat closes immediately without refreshing; re-opening the old invite link shows an invalid/expired message.
    4. Owner creates a fresh invite link and confirms the second user can join again.
    5. Owner deletes (soft-deletes) the card and confirms it disappears live while `kitchen.db` remains untouched.
  - Fails when: GitHub OAuth callback mismatches, cookies fail over HTTPS tunnel, SSE disconnects through Cloudflare Tunnel, or removal does not stop the second user's open chat immediately.

## Blocked by

- Local: `04-board-dst-and-model-conformance.md`
- Local: `05-board-web-ui.md`
