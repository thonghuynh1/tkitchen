export const LIVE_FRAME_KINDS = ["card_created", "card_moved", "message_created", "card_removed"] as const;
export type WebLiveFrameKind = (typeof LIVE_FRAME_KINDS)[number];

export type WebLiveFrame =
  | { kind: "card_created"; rawCard: unknown }
  | { kind: "card_moved"; cardId: string; column: "todo" | "doing" | "done" }
  | { kind: "message_created"; rawEntry: unknown }
  | { kind: "card_removed"; cardId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isColumn(value: unknown): value is "todo" | "doing" | "done" {
  return value === "todo" || value === "doing" || value === "done";
}

export function parseLiveFrame(kind: WebLiveFrameKind, rawJson: string): WebLiveFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  switch (kind) {
    case "card_created":
      return "card" in parsed ? { kind: "card_created", rawCard: parsed["card"] } : null;
    case "card_moved": {
      const cardId = parsed["cardId"];
      const column = parsed["column"];
      if (typeof cardId !== "string" || !isColumn(column)) return null;
      return { kind: "card_moved", cardId, column };
    }
    case "message_created":
      return "message" in parsed ? { kind: "message_created", rawEntry: parsed["message"] } : null;
    case "card_removed": {
      const cardId = parsed["cardId"];
      if (typeof cardId !== "string") return null;
      return { kind: "card_removed", cardId };
    }
  }
}
