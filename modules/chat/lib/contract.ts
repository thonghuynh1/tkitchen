import type { CardId } from "../../cards/index.ts";
import type { UserId } from "../../identities/index.ts";

export type ChatEntryId = string & { readonly chatEntryIdBrand: "ChatEntryId" };

const CHAT_ENTRY_ID_PATTERN = /^[A-Za-z0-9-]{8,}$/;

export function isChatEntryId(value: string): value is ChatEntryId {
  return CHAT_ENTRY_ID_PATTERN.test(value);
}

export interface ChatEntry {
  id: ChatEntryId;
  cardId: CardId;
  seq: number;
  replyToId: ChatEntryId | null;
  authorId: UserId;
  authorLogin: string;
  text: string;
  mentionsWaiter: boolean;
  createdAt: string;
}

export type NewChatEntry = Omit<ChatEntry, "seq">;

export interface ChatStore {
  getEntry(cardId: CardId, entryId: ChatEntryId): ChatEntry | null;
  appendEntry(entry: NewChatEntry): ChatEntry;
  listEntriesAfter(cardId: CardId, afterSeq: number): ChatEntry[];
}

export interface ChatCardAccess {
  getCard(cardId: CardId): { archivedAt: string | null } | null;
  isMember(cardId: CardId, userId: UserId): boolean;
}
