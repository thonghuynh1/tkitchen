import type { UserId } from "../../identities/index.ts";

export type CardId = string & { readonly cardIdBrand: "CardId" };
export type InviteToken = string & { readonly inviteTokenBrand: "InviteToken" };

export const CARD_COLUMNS = ["todo", "doing", "done"] as const;
export type CardColumn = (typeof CARD_COLUMNS)[number];

const CARD_ID_PATTERN = /^[A-Za-z0-9-]{8,}$/;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9]{16,}$/;

export function isCardId(value: string): value is CardId {
  return CARD_ID_PATTERN.test(value);
}

export function isInviteToken(value: string): value is InviteToken {
  return INVITE_TOKEN_PATTERN.test(value);
}

export function isCardColumn(value: unknown): value is CardColumn {
  return value === "todo" || value === "doing" || value === "done";
}

export interface Card {
  id: CardId;
  title: string;
  column: CardColumn;
  ownerId: UserId;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CardSummary {
  id: CardId;
  title: string;
  column: CardColumn;
  ownerId: UserId;
  memberIds: UserId[];
  createdAt: string;
  updatedAt: string;
}

export interface CardInvite {
  token: InviteToken;
  cardId: CardId;
  createdAt: string;
  revokedAt: string | null;
}

export interface CardStore {
  createCard(card: Card): void;
  getCard(cardId: CardId): Card | null;
  listActiveCardsForUser(userId: UserId): CardSummary[];
  updateCardColumn(cardId: CardId, column: CardColumn, updatedAt: string): CardSummary | null;
  isMember(cardId: CardId, userId: UserId): boolean;
  listMemberIds(cardId: CardId): UserId[];
  getActiveInvite(cardId: CardId): CardInvite | null;
  createInvite(invite: CardInvite): void;
  redeemInvite(token: InviteToken, userId: UserId, joinedAt: string): CardSummary | null;
  removeMemberAndRevokeInvite(cardId: CardId, userId: UserId, revokedAt: string): { removed: boolean };
  closeSharing(cardId: CardId, revokedAt: string): { removedUserIds: UserId[] };
  archiveCard(cardId: CardId, archivedAt: string): { archived: boolean; removedUserIds: UserId[] };
}
