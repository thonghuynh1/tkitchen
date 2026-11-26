import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteCardStore } from "../../cards/adapters.ts";
import { CardService, isCardId } from "../../cards/index.ts";
import type { CardId } from "../../cards/index.ts";
import { userIdFromGithub } from "../../identities/index.ts";
import type { UserId, Viewer } from "../../identities/index.ts";
import { SqliteChatStore } from "../adapters.ts";
import { ChatService, isChatEntryId, parseMentionsWaiter } from "../index.ts";
import type { ChatCardAccess, ChatEntry, ChatEntryId, ChatStore, NewChatEntry } from "../index.ts";

class CountingIds {
  private counter = 0;
  next(): string {
    this.counter += 1;
    return "00000000-0000-4000-8000-" + String(this.counter).padStart(12, "0");
  }
}

class MemoryChatStore implements ChatStore {
  readonly rows: ChatEntry[] = [];

  getEntry(cardId: CardId, entryId: ChatEntryId): ChatEntry | null {
    return this.rows.find((row) => row.cardId === cardId && row.id === entryId) ?? null;
  }

  appendEntry(entry: NewChatEntry): ChatEntry {
    const seq = this.rows.filter((row) => row.cardId === entry.cardId).length + 1;
    const saved: ChatEntry = { ...entry, seq };
    this.rows.push(saved);
    return saved;
  }

  listEntriesAfter(cardId: CardId, afterSeq: number): ChatEntry[] {
    return this.rows
      .filter((row) => row.cardId === cardId && row.seq > afterSeq)
      .toSorted((left, right) => left.seq - right.seq);
  }
}

function makeViewer(githubNum: number, login: string, isOwner: boolean): Viewer {
  return {
    user: { id: userIdFromGithub(githubNum), githubId: githubNum, login },
    isOwner,
  };
}

function requireCardId(raw: string): CardId {
  if (!isCardId(raw)) throw new Error("bad card id");
  return raw;
}

function requireEntryId(raw: string): ChatEntryId {
  if (!isChatEntryId(raw)) throw new Error("bad entry id");
  return raw;
}

const fixedClock = { now: (): Date => new Date(1_700_000_000_000) };

describe("chat domain", () => {
  it("flattens reply-to-reply onto parent and parses @waiter outside code spans", () => {
    expect(parseMentionsWaiter("hey @Waiter, check this")).toBe(true);
    expect(parseMentionsWaiter("@waiter: help")).toBe(true);
    expect(parseMentionsWaiter("(@WAITER)")).toBe(true);
    expect(parseMentionsWaiter("check `@waiter` and @waiter")).toBe(true);
    expect(parseMentionsWaiter("alice@waiter.io")).toBe(false);
    expect(parseMentionsWaiter("`@waiter`")).toBe(false);
    expect(parseMentionsWaiter("```\n@waiter\n```")).toBe(false);
    expect(parseMentionsWaiter("```ts\nconst x = '@waiter';\n```")).toBe(false);
    expect(parseMentionsWaiter("@waiters")).toBe(false);
    expect(parseMentionsWaiter("@waiter_bot")).toBe(false);

    const cardId = requireCardId("00000000-0000-4000-8000-000000000001");
    const otherCardId = requireCardId("00000000-0000-4000-8000-000000000002");
    const owner = makeViewer(1, "owner", true);
    const alice = makeViewer(2, "alice", false);
    const members = new Set<UserId>([owner.user.id, alice.user.id]);
    const cards: ChatCardAccess = {
      getCard: (id) => (id === cardId || id === otherCardId ? { archivedAt: null } : null),
      isMember: (_id, userId) => members.has(userId),
    };
    const store = new MemoryChatStore();
    const service = new ChatService({ store, cards, clock: fixedClock, ids: new CountingIds() });

    const rootOutcome = service.postEntry(owner, { cardId, text: "Root topic", replyToId: null });
    expect(rootOutcome.ok).toBe(true);
    if (!rootOutcome.ok) return;
    expect(rootOutcome.entry.seq).toBe(1);
    expect(rootOutcome.entry.replyToId).toBeNull();
    expect(rootOutcome.entry.mentionsWaiter).toBe(false);

    const firstReply = service.postEntry(alice, {
      cardId,
      text: "hey @Waiter, check this",
      replyToId: rootOutcome.entry.id,
    });
    expect(firstReply.ok).toBe(true);
    if (!firstReply.ok) return;
    expect(firstReply.entry.seq).toBe(2);
    expect(firstReply.entry.replyToId).toBe(rootOutcome.entry.id);
    expect(firstReply.entry.mentionsWaiter).toBe(true);

    const nestedReply = service.postEntry(owner, {
      cardId,
      text: "Replying to Alice's reply",
      replyToId: firstReply.entry.id,
    });
    expect(nestedReply.ok).toBe(true);
    if (!nestedReply.ok) return;
    expect(nestedReply.entry.seq).toBe(3);
    expect(nestedReply.entry.replyToId).toBe(rootOutcome.entry.id);

    const missingReplyRef = service.postEntry(owner, {
      cardId,
      text: "Bad reply",
      replyToId: requireEntryId("00000000-0000-4000-8000-999999999999"),
    });
    expect(missingReplyRef).toEqual({ ok: false, reason: "invalid-reply-target" });
    expect(store.rows).toHaveLength(3);

    const crossCardReplyRef = service.postEntry(owner, {
      cardId: otherCardId,
      text: "Cross-card reply",
      replyToId: rootOutcome.entry.id,
    });
    expect(crossCardReplyRef).toEqual({ ok: false, reason: "invalid-reply-target" });
    expect(store.rows).toHaveLength(3);

    const emptyText = service.postEntry(owner, { cardId, text: "   \n\t ", replyToId: null });
    expect(emptyText).toEqual({ ok: false, reason: "empty-text" });
    expect(store.rows).toHaveLength(3);

    const replacementOwner = makeViewer(4, "bob", true);
    const replacementRead = service.listEntries(replacementOwner, { cardId, afterSeq: 0 });
    expect(replacementRead.ok).toBe(true);
    if (replacementRead.ok) expect(replacementRead.entries).toHaveLength(3);
    const replacementPost = service.postEntry(replacementOwner, {
      cardId,
      text: "owner handover note",
      replyToId: null,
    });
    expect(replacementPost.ok).toBe(true);
    if (replacementPost.ok) expect(replacementPost.entry.seq).toBe(4);
  });

  it("persists monotonic per-card seq in SqliteChatStore across reopen and enforces membership", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tkitchen-chat-sqlite-"));
    const dbPath = join(dir, "board.db");
    try {
      const cardStore = new SqliteCardStore(dbPath);
      const chatStore = new SqliteChatStore(dbPath);
      const owner = makeViewer(1, "owner", true);
      const bob = makeViewer(4, "bob", false);
      const cardService = new CardService({ store: cardStore, clock: fixedClock, ids: new CountingIds() });
      const created = cardService.createCard(owner, { title: "Card A" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const chatService = new ChatService({
        store: chatStore,
        cards: cardStore,
        clock: fixedClock,
        ids: new CountingIds(),
      });

      const bobPost = chatService.postEntry(bob, { cardId: created.card.id, text: "intruder", replyToId: null });
      expect(bobPost).toEqual({ ok: false, reason: "forbidden" });
      const bobList = chatService.listEntries(bob, { cardId: created.card.id, afterSeq: 0 });
      expect(bobList).toEqual({ ok: false, reason: "forbidden" });

      const first = chatService.postEntry(owner, { cardId: created.card.id, text: "hello", replyToId: null });
      const second = chatService.postEntry(owner, {
        cardId: created.card.id,
        text: "@waiter: check",
        replyToId: first.ok ? first.entry.id : null,
      });
      expect(first.ok && first.entry.seq === 1).toBe(true);
      expect(second.ok && second.entry.seq === 2 && second.entry.mentionsWaiter).toBe(true);

      chatStore.close();
      cardStore.close();

      const reopenedCards = new SqliteCardStore(dbPath);
      const reopenedChat = new SqliteChatStore(dbPath);
      try {
        const reopenedService = new ChatService({
          store: reopenedChat,
          cards: reopenedCards,
          clock: fixedClock,
          ids: new CountingIds(),
        });
        const afterOne = reopenedService.listEntries(owner, { cardId: created.card.id, afterSeq: 1 });
        expect(afterOne.ok).toBe(true);
        if (afterOne.ok) {
          expect(afterOne.entries).toHaveLength(1);
          expect(afterOne.entries[0]?.seq).toBe(2);
          expect(afterOne.entries[0]?.mentionsWaiter).toBe(true);
        }
      } finally {
        reopenedChat.close();
        reopenedCards.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
