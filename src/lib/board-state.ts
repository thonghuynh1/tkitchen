import type { CardColumn, CardMemberId, WebCard, WebCardId } from "../../modules/cards/web";
import type { WebChatEntry } from "../../modules/chat/web";
import type { MeUser } from "../../modules/identities/web";

export type AppSession =
  | { kind: "loading" }
  | { kind: "unauthenticated"; returnTo: string }
  | { kind: "invite-redeeming"; user: MeUser; token: string }
  | { kind: "invite-invalid"; user: MeUser }
  | { kind: "board"; user: MeUser };

export interface BoardColumnSpec {
  readonly column: CardColumn;
  readonly title: string;
}

export const BOARD_COLUMNS: readonly BoardColumnSpec[] = [
  { column: "todo", title: "Todo" },
  { column: "doing", title: "Doing" },
  { column: "done", title: "Done" },
];

export interface ChatThreadGroup {
  readonly root: WebChatEntry;
  readonly replies: readonly WebChatEntry[];
}

export interface WaiterMentionMatch {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

const INVITE_PATH_PATTERN = /^\/invite\/([^/]+)\/?$/;
const WAITER_HANDLE = "waiter";

export function extractInviteTokenFromPath(pathname: string): string | null {
  const matched = INVITE_PATH_PATTERN.exec(pathname);
  const raw = matched?.[1];
  if (raw === undefined || raw === "") return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function upsertCard(cards: readonly WebCard[], incoming: WebCard): WebCard[] {
  const index = cards.findIndex((card) => card.id === incoming.id);
  if (index === -1) return [...cards, incoming];
  return cards.map((card, idx) => (idx === index ? incoming : card));
}

export function moveCardInList(cards: readonly WebCard[], cardId: WebCardId, column: CardColumn): WebCard[] {
  return cards.map((card) => (card.id === cardId ? { ...card, column } : card));
}

export function removeCardFromList(cards: readonly WebCard[], cardId: WebCardId): WebCard[] {
  return cards.filter((card) => card.id !== cardId);
}

export function ensureCardMember(cards: readonly WebCard[], cardId: WebCardId, memberId: CardMemberId): WebCard[] {
  return cards.map((card) => {
    if (card.id !== cardId || card.memberIds.includes(memberId)) return card;
    return { ...card, memberIds: [...card.memberIds, memberId] };
  });
}

export function removeCardMemberFromList(
  cards: readonly WebCard[],
  cardId: WebCardId,
  memberId: CardMemberId,
): WebCard[] {
  return cards.map((card) => {
    if (card.id !== cardId) return card;
    return { ...card, memberIds: card.memberIds.filter((id) => id !== memberId) };
  });
}

export function closeCardSharingInList(cards: readonly WebCard[], cardId: WebCardId): WebCard[] {
  return cards.map((card) => {
    if (card.id !== cardId) return card;
    return { ...card, memberIds: card.memberIds.filter((id) => id === card.ownerId) };
  });
}

export function mergeChatEntries(existing: readonly WebChatEntry[], incoming: readonly WebChatEntry[]): WebChatEntry[] {
  const byId = new Map<string, WebChatEntry>();
  for (const entry of existing) byId.set(entry.id, entry);
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}

export function lastSeqOf(entries: readonly WebChatEntry[]): number {
  let latest = 0;
  for (const entry of entries) {
    if (entry.seq > latest) latest = entry.seq;
  }
  return latest;
}

export function groupChatThreads(entries: readonly WebChatEntry[]): ChatThreadGroup[] {
  const ordered = [...entries].sort((left, right) => left.seq - right.seq);
  const repliesByRoot = new Map<string, WebChatEntry[]>();
  const roots: WebChatEntry[] = [];
  const rootIds = new Set<string>();

  for (const entry of ordered) {
    if (entry.replyToId === null) {
      roots.push(entry);
      rootIds.add(entry.id);
    }
  }
  for (const entry of ordered) {
    if (entry.replyToId === null) continue;
    if (!rootIds.has(entry.replyToId)) {
      roots.push(entry);
      rootIds.add(entry.id);
      continue;
    }
    const list = repliesByRoot.get(entry.replyToId);
    if (list === undefined) repliesByRoot.set(entry.replyToId, [entry]);
    else list.push(entry);
  }
  roots.sort((left, right) => left.seq - right.seq);
  return roots.map((root) => ({ root, replies: repliesByRoot.get(root.id) ?? [] }));
}

export function findWaiterMentionMatch(text: string, cursor: number): WaiterMentionMatch | null {
  const clamped = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, clamped);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) return null;
  if (atIndex > 0) {
    const preceding = before[atIndex - 1];
    if (preceding !== undefined && !/\s/.test(preceding)) return null;
  }
  const query = before.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  if (!WAITER_HANDLE.startsWith(query.toLowerCase())) return null;
  return { start: atIndex, end: clamped, query };
}

export function applyWaiterMention(text: string, match: WaiterMentionMatch): { nextText: string; nextCursor: number } {
  const inserted = "@waiter ";
  const nextText = text.slice(0, match.start) + inserted + text.slice(match.end);
  return { nextText, nextCursor: match.start + inserted.length };
}
