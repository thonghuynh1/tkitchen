import type { CardId } from "../../cards/index.ts";
import type { Viewer } from "../../identities/index.ts";
import type { Clock, Ids } from "../../platform/index.ts";
import { isChatEntryId } from "./contract.ts";
import type { ChatCardAccess, ChatEntry, ChatEntryId, ChatStore } from "./contract.ts";
import { parseMentionsWaiter } from "./waiter-mention.ts";

export interface ChatServiceDeps {
  store: ChatStore;
  cards: ChatCardAccess;
  clock: Clock;
  ids: Ids;
}

export type ListChatOutcome = { ok: true; entries: ChatEntry[] } | { ok: false; reason: "not-found" | "forbidden" };

export type PostChatOutcome =
  | { ok: true; entry: ChatEntry }
  | { ok: false; reason: "not-found" | "forbidden" | "empty-text" | "invalid-reply-target" };

export class ChatService {
  private readonly store: ChatStore;
  private readonly cards: ChatCardAccess;
  private readonly clock: Clock;
  private readonly ids: Ids;

  constructor(deps: ChatServiceDeps) {
    this.store = deps.store;
    this.cards = deps.cards;
    this.clock = deps.clock;
    this.ids = deps.ids;
  }

  private checkAccess(viewer: Viewer, cardId: CardId): "ok" | "not-found" | "forbidden" {
    const card = this.cards.getCard(cardId);
    if (card === null || card.archivedAt !== null) return "not-found";
    if (!this.cards.isMember(cardId, viewer.user.id)) return "forbidden";
    return "ok";
  }

  listEntries(viewer: Viewer, input: { cardId: CardId; afterSeq: number }): ListChatOutcome {
    const access = this.checkAccess(viewer, input.cardId);
    if (access !== "ok") return { ok: false, reason: access };
    return { ok: true, entries: this.store.listEntriesAfter(input.cardId, input.afterSeq) };
  }

  postEntry(viewer: Viewer, input: { cardId: CardId; text: string; replyToId: ChatEntryId | null }): PostChatOutcome {
    const access = this.checkAccess(viewer, input.cardId);
    if (access !== "ok") return { ok: false, reason: access };
    if (input.text.trim() === "") return { ok: false, reason: "empty-text" };
    let resolvedReplyToId: ChatEntryId | null = null;
    if (input.replyToId !== null) {
      const referenced = this.store.getEntry(input.cardId, input.replyToId);
      if (referenced === null) return { ok: false, reason: "invalid-reply-target" };
      resolvedReplyToId = referenced.replyToId ?? referenced.id;
    }
    const rawId = this.ids.next();
    if (!isChatEntryId(rawId)) throw new Error("chat entry id is not well formed");
    const entry = this.store.appendEntry({
      id: rawId,
      cardId: input.cardId,
      replyToId: resolvedReplyToId,
      authorId: viewer.user.id,
      authorLogin: viewer.user.login,
      text: input.text,
      mentionsWaiter: parseMentionsWaiter(input.text),
      createdAt: this.clock.now().toISOString(),
    });
    return { ok: true, entry };
  }
}
