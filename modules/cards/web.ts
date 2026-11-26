export type WebCardId = string & { readonly webCardIdBrand: "WebCardId" };
export type WebInviteToken = string & { readonly webInviteTokenBrand: "WebInviteToken" };
export type CardMemberId = string & { readonly cardMemberIdBrand: "CardMemberId" };

export const CARD_COLUMNS = ["todo", "doing", "done"] as const;
export type CardColumn = (typeof CARD_COLUMNS)[number];

const CARD_ID_PATTERN = /^[A-Za-z0-9-]{8,}$/;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9]{16,}$/;
const MEMBER_ID_PATTERN = /^github:[1-9][0-9]*$/;

export function isWebCardId(value: unknown): value is WebCardId {
  return typeof value === "string" && CARD_ID_PATTERN.test(value);
}

export function isWebInviteToken(value: unknown): value is WebInviteToken {
  return typeof value === "string" && INVITE_TOKEN_PATTERN.test(value);
}

export function isCardMemberId(value: unknown): value is CardMemberId {
  return typeof value === "string" && MEMBER_ID_PATTERN.test(value);
}

export function isCardColumn(value: unknown): value is CardColumn {
  return value === "todo" || value === "doing" || value === "done";
}

export interface WebCard {
  id: WebCardId;
  title: string;
  column: CardColumn;
  ownerId: CardMemberId;
  memberIds: CardMemberId[];
  createdAt: string;
  updatedAt: string;
}

export interface WebInviteLink {
  token: WebInviteToken;
  url: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMemberIds(raw: unknown): CardMemberId[] | null {
  if (!Array.isArray(raw)) return null;
  const parsed: CardMemberId[] = [];
  for (const item of raw) {
    if (!isCardMemberId(item)) return null;
    parsed.push(item);
  }
  return parsed;
}

export function parseWebCard(raw: unknown): WebCard | null {
  if (!isRecord(raw)) return null;
  const id = raw["id"];
  const title = raw["title"];
  const column = raw["column"];
  const ownerId = raw["ownerId"];
  const memberIds = parseMemberIds(raw["memberIds"]);
  const createdAt = raw["createdAt"];
  const updatedAt = raw["updatedAt"];
  if (
    !isWebCardId(id) ||
    typeof title !== "string" ||
    !isCardColumn(column) ||
    !isCardMemberId(ownerId) ||
    memberIds === null ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string"
  ) {
    return null;
  }
  return { id, title, column, ownerId, memberIds, createdAt, updatedAt };
}

export function parseCardsListResponse(raw: unknown): WebCard[] | null {
  if (!isRecord(raw) || raw["ok"] !== true) return null;
  const cards = raw["cards"];
  if (!Array.isArray(cards)) return null;
  const parsed: WebCard[] = [];
  for (const item of cards) {
    const card = parseWebCard(item);
    if (card === null) return null;
    parsed.push(card);
  }
  return parsed;
}

export function parseCardSingleResponse(raw: unknown): WebCard | null {
  if (!isRecord(raw) || raw["ok"] !== true) return null;
  return parseWebCard(raw["card"]);
}

export function parseInviteLinkResponse(raw: unknown): WebInviteLink | null {
  if (!isRecord(raw) || raw["ok"] !== true) return null;
  const token = raw["token"];
  const url = raw["url"];
  if (!isWebInviteToken(token) || typeof url !== "string") return null;
  return { token, url };
}

export function parseRemoveMemberResponse(raw: unknown): CardMemberId | null {
  if (!isRecord(raw) || raw["ok"] !== true) return null;
  const removed = raw["removedUserId"];
  return isCardMemberId(removed) ? removed : null;
}

export function parseCloseSharingResponse(raw: unknown): CardMemberId[] | null {
  if (!isRecord(raw) || raw["ok"] !== true) return null;
  return parseMemberIds(raw["removedUserIds"]);
}

export function parseArchiveCardResponse(raw: unknown): { archivedAt: string; removedUserIds: CardMemberId[] } | null {
  if (!isRecord(raw) || raw["ok"] !== true) return null;
  const archivedAt = raw["archivedAt"];
  const removedUserIds = parseMemberIds(raw["removedUserIds"]);
  if (typeof archivedAt !== "string" || removedUserIds === null) return null;
  return { archivedAt, removedUserIds };
}
