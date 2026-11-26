import type { UserId, Viewer } from "../../identities/index.ts";
import type { Clock, Ids } from "../../platform/index.ts";
import { isCardId, isInviteToken } from "./contract.ts";
import type { Card, CardColumn, CardId, CardInvite, CardStore, CardSummary, InviteToken } from "./contract.ts";

export interface CardServiceDeps {
  store: CardStore;
  clock: Clock;
  ids: Ids;
}

export type CreateCardOutcome = { ok: true; card: CardSummary } | { ok: false; reason: "forbidden" | "invalid-title" };

export type MoveCardOutcome = { ok: true; card: CardSummary } | { ok: false; reason: "not-found" | "forbidden" };

export type CreateInviteOutcome = { ok: true; invite: CardInvite } | { ok: false; reason: "forbidden" | "not-found" };

export type RedeemInviteOutcome = { ok: true; card: CardSummary } | { ok: false; reason: "gone" };

export type RemoveMemberOutcome =
  | { ok: true; card: CardSummary; removedUserId: UserId; removedUserIds: UserId[] }
  | { ok: false; reason: "forbidden" | "not-found" | "cannot-remove-owner" };

export type CloseSharingOutcome =
  | { ok: true; card: CardSummary; removedUserIds: UserId[] }
  | { ok: false; reason: "forbidden" | "not-found" };

export type ArchiveCardOutcome =
  | { ok: true; card: Card; archivedAt: string; removedUserIds: UserId[] }
  | { ok: false; reason: "forbidden" | "not-found" };

export class CardService {
  private readonly store: CardStore;
  private readonly clock: Clock;
  private readonly ids: Ids;

  constructor(deps: CardServiceDeps) {
    this.store = deps.store;
    this.clock = deps.clock;
    this.ids = deps.ids;
  }

  private summaryOf(card: Card): CardSummary {
    return {
      id: card.id,
      title: card.title,
      column: card.column,
      ownerId: card.ownerId,
      memberIds: this.store.listMemberIds(card.id),
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  }

  private nextToken(): InviteToken {
    const raw = (this.ids.next() + this.ids.next()).replaceAll("-", "");
    if (!isInviteToken(raw)) throw new Error("invite token is not well formed");
    return raw;
  }

  listCards(viewer: Viewer): CardSummary[] {
    return this.store.listActiveCardsForUser(viewer.user.id);
  }

  createCard(viewer: Viewer, input: { title: string }): CreateCardOutcome {
    if (!viewer.isOwner) return { ok: false, reason: "forbidden" };
    const title = input.title.trim();
    if (title === "") return { ok: false, reason: "invalid-title" };
    const rawId = this.ids.next();
    if (!isCardId(rawId)) throw new Error("card id is not well formed");
    const now = this.clock.now().toISOString();
    const card: Card = {
      id: rawId,
      title,
      column: "todo",
      ownerId: viewer.user.id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    this.store.createCard(card);
    return {
      ok: true,
      card: {
        id: card.id,
        title: card.title,
        column: card.column,
        ownerId: card.ownerId,
        memberIds: [viewer.user.id],
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      },
    };
  }

  moveCard(viewer: Viewer, input: { cardId: CardId; column: CardColumn }): MoveCardOutcome {
    const card = this.store.getCard(input.cardId);
    if (card === null || card.archivedAt !== null) return { ok: false, reason: "not-found" };
    if (!this.store.isMember(input.cardId, viewer.user.id)) {
      return { ok: false, reason: "forbidden" };
    }
    const moved = this.store.updateCardColumn(input.cardId, input.column, this.clock.now().toISOString());
    if (moved === null) return { ok: false, reason: "not-found" };
    return { ok: true, card: moved };
  }

  getOrCreateInvite(viewer: Viewer, input: { cardId: CardId }): CreateInviteOutcome {
    if (!viewer.isOwner) return { ok: false, reason: "forbidden" };
    const card = this.store.getCard(input.cardId);
    if (card === null || card.archivedAt !== null) return { ok: false, reason: "not-found" };
    const existing = this.store.getActiveInvite(input.cardId);
    if (existing !== null) return { ok: true, invite: existing };
    const invite: CardInvite = {
      token: this.nextToken(),
      cardId: input.cardId,
      createdAt: this.clock.now().toISOString(),
      revokedAt: null,
    };
    this.store.createInvite(invite);
    return { ok: true, invite };
  }

  redeemInvite(viewer: Viewer, input: { token: InviteToken }): RedeemInviteOutcome {
    const card = this.store.redeemInvite(input.token, viewer.user.id, this.clock.now().toISOString());
    if (card === null) return { ok: false, reason: "gone" };
    return { ok: true, card };
  }

  removeMember(viewer: Viewer, input: { cardId: CardId; memberId: UserId }): RemoveMemberOutcome {
    if (!viewer.isOwner) return { ok: false, reason: "forbidden" };
    const card = this.store.getCard(input.cardId);
    if (card === null || card.archivedAt !== null) return { ok: false, reason: "not-found" };
    if (input.memberId === card.ownerId) return { ok: false, reason: "cannot-remove-owner" };
    const outcome = this.store.removeMemberAndRevokeInvite(
      input.cardId,
      input.memberId,
      this.clock.now().toISOString(),
    );
    return {
      ok: true,
      card: this.summaryOf(card),
      removedUserId: input.memberId,
      removedUserIds: outcome.removed ? [input.memberId] : [],
    };
  }

  closeSharing(viewer: Viewer, input: { cardId: CardId }): CloseSharingOutcome {
    if (!viewer.isOwner) return { ok: false, reason: "forbidden" };
    const card = this.store.getCard(input.cardId);
    if (card === null || card.archivedAt !== null) return { ok: false, reason: "not-found" };
    const closed = this.store.closeSharing(input.cardId, this.clock.now().toISOString());
    return {
      ok: true,
      card: this.summaryOf(card),
      removedUserIds: closed.removedUserIds,
    };
  }

  archiveCard(viewer: Viewer, input: { cardId: CardId }): ArchiveCardOutcome {
    if (!viewer.isOwner) return { ok: false, reason: "forbidden" };
    const card = this.store.getCard(input.cardId);
    if (card === null || card.archivedAt !== null) return { ok: false, reason: "not-found" };
    const archivedAt = this.clock.now().toISOString();
    const archived = this.store.archiveCard(input.cardId, archivedAt);
    if (!archived.archived) return { ok: false, reason: "not-found" };
    return {
      ok: true,
      card: { ...card, archivedAt, updatedAt: archivedAt },
      archivedAt,
      removedUserIds: archived.removedUserIds,
    };
  }

  isMember(cardId: CardId, userId: UserId): boolean {
    return this.store.isMember(cardId, userId);
  }

  listMemberIds(cardId: CardId): UserId[] {
    return this.store.listMemberIds(cardId);
  }
}
