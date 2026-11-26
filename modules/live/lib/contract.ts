import type { CardId } from "../../cards/index.ts";
import type { UserId } from "../../identities/index.ts";

export type LiveFrameKind = "card_created" | "card_moved" | "message_created" | "card_removed";

export interface LiveHandle {
  write(chunk: string): void;
  end(): void;
}

export interface LiveHub {
  register(userId: UserId, handle: LiveHandle): () => void;
  broadcast(userIds: readonly UserId[], kind: LiveFrameKind, payload: unknown): void;
  revokeCardAccess(cardId: CardId, removedUserIds: readonly UserId[]): void;
  closeAll(): void;
  connectionCount(userId?: UserId): number;
}
