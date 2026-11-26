import { describe, expect, it } from "vitest";
import { isCardId } from "../../cards/index.ts";
import type { CardId } from "../../cards/index.ts";
import { userIdFromGithub } from "../../identities/index.ts";
import { formatSseFrame, InMemoryLiveHub } from "../index.ts";
import type { LiveHandle } from "../index.ts";

class SpyHandle implements LiveHandle {
  readonly chunks: string[] = [];
  ended = false;

  write(chunk: string): void {
    if (this.ended) throw new Error("write after end");
    this.chunks.push(chunk);
  }

  end(): void {
    this.ended = true;
  }
}

function requireCardId(raw: string): CardId {
  if (!isCardId(raw)) throw new Error("bad card id");
  return raw;
}

describe("live hub", () => {
  it("formats SSE frames, filters broadcasts by user, and immediately ends handles on revokeCardAccess", () => {
    const hub = new InMemoryLiveHub();
    const ownerId = userIdFromGithub(1);
    const aliceId = userIdFromGithub(2);
    const bobId = userIdFromGithub(4);
    const cardId = requireCardId("00000000-0000-4000-8000-000000000001");

    const ownerHandle = new SpyHandle();
    const aliceTab1 = new SpyHandle();
    const aliceTab2 = new SpyHandle();
    const bobHandle = new SpyHandle();

    const unregOwner = hub.register(ownerId, ownerHandle);
    hub.register(aliceId, aliceTab1);
    hub.register(aliceId, aliceTab2);
    hub.register(bobId, bobHandle);
    expect(hub.connectionCount()).toBe(4);
    expect(hub.connectionCount(aliceId)).toBe(2);

    hub.broadcast([ownerId, aliceId, aliceId], "card_moved", { cardId, column: "doing" });
    const expectedMove = formatSseFrame("card_moved", { cardId, column: "doing" });
    expect(ownerHandle.chunks).toEqual([expectedMove]);
    expect(aliceTab1.chunks).toEqual([expectedMove]);
    expect(aliceTab2.chunks).toEqual([expectedMove]);
    expect(bobHandle.chunks).toEqual([]);

    hub.revokeCardAccess(cardId, [aliceId]);
    const expectedRemoved = formatSseFrame("card_removed", { cardId });
    expect(aliceTab1.ended).toBe(true);
    expect(aliceTab2.ended).toBe(true);
    expect(aliceTab1.chunks).toEqual([expectedMove, expectedRemoved]);
    expect(aliceTab2.chunks).toEqual([expectedMove, expectedRemoved]);
    expect(hub.connectionCount(aliceId)).toBe(0);
    expect(ownerHandle.ended).toBe(false);

    hub.broadcast([ownerId, aliceId], "message_created", { message: { seq: 2 } });
    expect(aliceTab1.chunks).toHaveLength(2);
    expect(ownerHandle.chunks).toHaveLength(2);

    unregOwner();
    expect(hub.connectionCount(ownerId)).toBe(0);

    hub.closeAll();
    expect(bobHandle.ended).toBe(true);
    expect(hub.connectionCount()).toBe(0);
  });
});
