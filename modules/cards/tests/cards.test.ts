import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userIdFromGithub } from "../../identities/index.ts";
import type { Viewer } from "../../identities/index.ts";
import { SqliteCardStore } from "../adapters.ts";
import { CardService, isCardColumn, isCardId, isInviteToken } from "../index.ts";

class FixedClock {
  private currentMs: number;
  constructor(startMs: number) {
    this.currentMs = startMs;
  }
  now(): Date {
    return new Date(this.currentMs);
  }
  advance(ms: number): void {
    this.currentMs += ms;
  }
}

class CountingIds {
  private counter = 0;
  next(): string {
    this.counter += 1;
    return "00000000-0000-4000-8000-" + String(this.counter).padStart(12, "0");
  }
}

function makeViewer(numeric: number, login: string, ownerFlag: boolean): Viewer {
  return {
    user: { id: userIdFromGithub(numeric), githubId: numeric, login },
    isOwner: ownerFlag,
  };
}

const OWNER = makeViewer(1, "owner", true);
const ALICE = makeViewer(2, "alice", false);
const CHARLIE = makeViewer(3, "charlie", false);
const BOB = makeViewer(4, "bob", false);

let dir: string;
let dbPath: string;
let store: SqliteCardStore;
let clock: FixedClock;
let ids: CountingIds;
let service: CardService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tkitchen-cards-"));
  dbPath = join(dir, "board.db");
  store = new SqliteCardStore(dbPath);
  clock = new FixedClock(1_700_000_000_000);
  ids = new CountingIds();
  service = new CardService({ store, clock, ids });
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe("guards", () => {
  it("validates card ids, invite tokens, and columns", () => {
    expect(isCardId("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isCardId("short")).toBe(false);
    expect(isCardId("bad/id/here")).toBe(false);
    expect(isInviteToken("abcdef0123456789")).toBe(true);
    expect(isInviteToken("short")).toBe(false);
    expect(isInviteToken("abcdef01-23456789")).toBe(false);
    expect(isCardColumn("todo")).toBe(true);
    expect(isCardColumn("doing")).toBe(true);
    expect(isCardColumn("done")).toBe(true);
    expect(isCardColumn("backlog")).toBe(false);
    expect(isCardColumn(42)).toBe(false);
  });
});

describe("CardService", () => {
  it("enforces owner-only creation, trims titles, and hides cards from strangers", () => {
    expect(service.createCard(BOB, { title: "nope" })).toEqual({ ok: false, reason: "forbidden" });
    expect(service.createCard(OWNER, { title: "   " })).toEqual({ ok: false, reason: "invalid-title" });

    const created = service.createCard(OWNER, { title: "  Ship board  " });
    if (!created.ok) throw new Error("expected card creation");
    expect(created.card.title).toBe("Ship board");
    expect(created.card.column).toBe("todo");
    expect(created.card.ownerId).toBe(OWNER.user.id);
    expect(created.card.memberIds).toEqual([OWNER.user.id]);

    expect(service.listCards(OWNER)).toHaveLength(1);
    expect(service.listCards(BOB)).toEqual([]);
    expect(service.isMember(created.card.id, OWNER.user.id)).toBe(true);
    expect(service.isMember(created.card.id, BOB.user.id)).toBe(false);
  });

  it("supports multi-use idempotent invites and column moves by any member", () => {
    const created = service.createCard(OWNER, { title: "Card 1" });
    if (!created.ok) throw new Error("expected card creation");
    const cardId = created.card.id;

    expect(service.getOrCreateInvite(ALICE, { cardId })).toEqual({ ok: false, reason: "forbidden" });
    const firstInvite = service.getOrCreateInvite(OWNER, { cardId });
    const secondInvite = service.getOrCreateInvite(OWNER, { cardId });
    if (!firstInvite.ok || !secondInvite.ok) throw new Error("expected invite");
    expect(secondInvite.invite.token).toBe(firstInvite.invite.token);

    const aliceJoin = service.redeemInvite(ALICE, { token: firstInvite.invite.token });
    const aliceAgain = service.redeemInvite(ALICE, { token: firstInvite.invite.token });
    const charlieJoin = service.redeemInvite(CHARLIE, { token: firstInvite.invite.token });
    if (!aliceJoin.ok || !aliceAgain.ok || !charlieJoin.ok) throw new Error("expected redeem");
    expect(service.listMemberIds(cardId)).toEqual([OWNER.user.id, ALICE.user.id, CHARLIE.user.id]);

    expect(service.moveCard(BOB, { cardId, column: "doing" })).toEqual({ ok: false, reason: "forbidden" });
    clock.advance(1000);
    const movedByAlice = service.moveCard(ALICE, { cardId, column: "doing" });
    if (!movedByAlice.ok) throw new Error("expected move");
    expect(movedByAlice.card.column).toBe("doing");
    expect(movedByAlice.card.updatedAt).not.toBe(created.card.updatedAt);

    clock.advance(1000);
    const movedByCharlie = service.moveCard(CHARLIE, { cardId, column: "done" });
    if (!movedByCharlie.ok) throw new Error("expected move");
    expect(movedByCharlie.card.column).toBe("done");
  });

  it("revokes active invite on member removal, refuses removing owner, and mints fresh token", () => {
    const created = service.createCard(OWNER, { title: "Shared" });
    if (!created.ok) throw new Error("expected card creation");
    const cardId = created.card.id;

    const inv1 = service.getOrCreateInvite(OWNER, { cardId });
    if (!inv1.ok) throw new Error("expected invite");
    service.redeemInvite(ALICE, { token: inv1.invite.token });
    service.redeemInvite(CHARLIE, { token: inv1.invite.token });

    expect(service.removeMember(ALICE, { cardId, memberId: CHARLIE.user.id })).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(service.removeMember(OWNER, { cardId, memberId: OWNER.user.id })).toEqual({
      ok: false,
      reason: "cannot-remove-owner",
    });

    const removed = service.removeMember(OWNER, { cardId, memberId: ALICE.user.id });
    if (!removed.ok) throw new Error("expected removal");
    expect(removed.removedUserId).toBe(ALICE.user.id);
    expect(removed.removedUserIds).toEqual([ALICE.user.id]);
    expect(removed.card.memberIds).toEqual([OWNER.user.id, CHARLIE.user.id]);

    expect(service.redeemInvite(ALICE, { token: inv1.invite.token })).toEqual({ ok: false, reason: "gone" });
    expect(service.moveCard(ALICE, { cardId, column: "doing" })).toEqual({ ok: false, reason: "forbidden" });
    expect(service.listCards(CHARLIE)).toHaveLength(1);

    const inv2 = service.getOrCreateInvite(OWNER, { cardId });
    if (!inv2.ok) throw new Error("expected second invite");
    expect(inv2.invite.token).not.toBe(inv1.invite.token);
    expect(service.redeemInvite(ALICE, { token: inv2.invite.token }).ok).toBe(true);
  });

  it("closes sharing, soft-deletes while keeping the SQLite row, and persists across restarts", () => {
    const created = service.createCard(OWNER, { title: "Persist me" });
    if (!created.ok) throw new Error("expected card creation");
    const cardId = created.card.id;

    const inv = service.getOrCreateInvite(OWNER, { cardId });
    if (!inv.ok) throw new Error("expected invite");
    service.redeemInvite(ALICE, { token: inv.invite.token });
    service.redeemInvite(CHARLIE, { token: inv.invite.token });

    store.close();
    store = new SqliteCardStore(dbPath);
    service = new CardService({ store, clock, ids });

    expect(service.listCards(ALICE).map((c) => c.id)).toEqual([cardId]);
    expect(service.closeSharing(ALICE, { cardId })).toEqual({ ok: false, reason: "forbidden" });

    const closed = service.closeSharing(OWNER, { cardId });
    if (!closed.ok) throw new Error("expected close sharing");
    expect(closed.removedUserIds).toEqual([ALICE.user.id, CHARLIE.user.id]);
    expect(service.listMemberIds(cardId)).toEqual([OWNER.user.id]);
    expect(service.redeemInvite(ALICE, { token: inv.invite.token })).toEqual({ ok: false, reason: "gone" });

    const inv2 = service.getOrCreateInvite(OWNER, { cardId });
    if (!inv2.ok) throw new Error("expected invite");
    service.redeemInvite(ALICE, { token: inv2.invite.token });

    expect(service.archiveCard(ALICE, { cardId })).toEqual({ ok: false, reason: "forbidden" });
    clock.advance(5000);
    const archived = service.archiveCard(OWNER, { cardId });
    if (!archived.ok) throw new Error("expected archive");
    expect(archived.archivedAt).toBe(clock.now().toISOString());
    expect(archived.removedUserIds).toEqual([ALICE.user.id]);

    expect(service.listCards(OWNER)).toEqual([]);
    expect(service.listCards(ALICE)).toEqual([]);
    expect(service.moveCard(OWNER, { cardId, column: "done" })).toEqual({ ok: false, reason: "not-found" });
    expect(service.getOrCreateInvite(OWNER, { cardId })).toEqual({ ok: false, reason: "not-found" });
    expect(service.redeemInvite(CHARLIE, { token: inv2.invite.token })).toEqual({ ok: false, reason: "gone" });
    expect(service.archiveCard(OWNER, { cardId })).toEqual({ ok: false, reason: "not-found" });

    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare("SELECT id, archived_at FROM cards WHERE id = ?").get(cardId);
      expect(row).toEqual({ id: cardId, archived_at: archived.archivedAt });
    } finally {
      db.close();
    }
  });
});
