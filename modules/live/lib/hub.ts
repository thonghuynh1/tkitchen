import type { CardId } from "../../cards/index.ts";
import type { UserId } from "../../identities/index.ts";
import type { LiveFrameKind, LiveHandle, LiveHub } from "./contract.ts";

export function formatSseFrame(kind: LiveFrameKind, payload: unknown): string {
  return "event: " + kind + "\ndata: " + JSON.stringify(payload) + "\n\n";
}

function safeWrite(handle: LiveHandle, chunk: string): boolean {
  try {
    handle.write(chunk);
    return true;
  } catch {
    return false;
  }
}

function safeEnd(handle: LiveHandle): void {
  try {
    handle.end();
  } catch {
    return;
  }
}

export class InMemoryLiveHub implements LiveHub {
  private readonly handlesByUser = new Map<UserId, Set<LiveHandle>>();

  register(userId: UserId, handle: LiveHandle): () => void {
    let handles = this.handlesByUser.get(userId);
    if (handles === undefined) {
      handles = new Set<LiveHandle>();
      this.handlesByUser.set(userId, handles);
    }
    handles.add(handle);
    return () => {
      const current = this.handlesByUser.get(userId);
      if (current === undefined) return;
      current.delete(handle);
      if (current.size === 0) this.handlesByUser.delete(userId);
    };
  }

  broadcast(userIds: readonly UserId[], kind: LiveFrameKind, payload: unknown): void {
    const frame = formatSseFrame(kind, payload);
    const recipients = new Set<UserId>(userIds);
    for (const userId of recipients) {
      const handles = this.handlesByUser.get(userId);
      if (handles === undefined) continue;
      for (const handle of [...handles]) {
        if (!safeWrite(handle, frame)) {
          handles.delete(handle);
          safeEnd(handle);
        }
      }
      if (handles.size === 0) this.handlesByUser.delete(userId);
    }
  }

  revokeCardAccess(cardId: CardId, removedUserIds: readonly UserId[]): void {
    const frame = formatSseFrame("card_removed", { cardId });
    const recipients = new Set<UserId>(removedUserIds);
    for (const userId of recipients) {
      const handles = this.handlesByUser.get(userId);
      if (handles === undefined) continue;
      this.handlesByUser.delete(userId);
      for (const handle of handles) {
        safeWrite(handle, frame);
        safeEnd(handle);
      }
    }
  }

  closeAll(): void {
    const allHandles: LiveHandle[] = [];
    for (const handles of this.handlesByUser.values()) {
      for (const handle of handles) allHandles.push(handle);
    }
    this.handlesByUser.clear();
    for (const handle of allHandles) safeEnd(handle);
  }

  connectionCount(userId?: UserId): number {
    if (userId !== undefined) return this.handlesByUser.get(userId)?.size ?? 0;
    let total = 0;
    for (const handles of this.handlesByUser.values()) total += handles.size;
    return total;
  }
}
