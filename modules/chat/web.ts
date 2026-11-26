export type WebChatEntryId = string & { readonly webChatEntryIdBrand: "WebChatEntryId" };

const CHAT_ENTRY_ID_PATTERN = /^[A-Za-z0-9-]{8,}$/;

export function isWebChatEntryId(value: unknown): value is WebChatEntryId {
  return typeof value === "string" && CHAT_ENTRY_ID_PATTERN.test(value);
}

export interface WebChatEntry {
  id: WebChatEntryId;
  cardId: string;
  seq: number;
  replyToId: WebChatEntryId | null;
  authorId: string;
  authorLogin: string;
  text: string;
  mentionsWaiter: boolean;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseReplyToId(raw: unknown): WebChatEntryId | null | undefined {
  if (raw === null || raw === undefined) return null;
  return isWebChatEntryId(raw) ? raw : undefined;
}

export function parseWebChatEntry(raw: unknown): WebChatEntry | null {
  if (!isRecord(raw)) return null;
  const id = raw["id"];
  const cardId = raw["cardId"];
  const seq = raw["seq"];
  const replyToId = parseReplyToId(raw["parentId"]);
  const authorId = raw["authorId"];
  const authorLogin = raw["authorLogin"];
  const text = raw["text"];
  const mentionsWaiter = raw["mentionsWaiter"];
  const createdAt = raw["createdAt"];
  if (
    !isWebChatEntryId(id) ||
    typeof cardId !== "string" ||
    typeof seq !== "number" ||
    !Number.isSafeInteger(seq) ||
    replyToId === undefined ||
    typeof authorId !== "string" ||
    typeof authorLogin !== "string" ||
    typeof text !== "string" ||
    typeof mentionsWaiter !== "boolean" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }
  return { id, cardId, seq, replyToId, authorId, authorLogin, text, mentionsWaiter, createdAt };
}

export function parseChatListResponse(raw: unknown): WebChatEntry[] | null {
  if (!isRecord(raw) || raw["ok"] !== true) return null;
  const list = raw["messages"];
  if (!Array.isArray(list)) return null;
  const parsed: WebChatEntry[] = [];
  for (const item of list) {
    const entry = parseWebChatEntry(item);
    if (entry === null) return null;
    parsed.push(entry);
  }
  return parsed;
}

export function parseChatPostResponse(raw: unknown): WebChatEntry | null {
  if (!isRecord(raw) || raw["ok"] !== true) return null;
  return parseWebChatEntry(raw["message"]);
}
