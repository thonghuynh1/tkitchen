import type { IncomingMessage, ServerResponse } from "node:http";
import { isCardId } from "../../../cards/index.ts";
import type { CardId, CardService } from "../../../cards/index.ts";
import { isChatEntryId } from "../../../chat/index.ts";
import type { ChatEntry, ChatEntryId, ChatService } from "../../../chat/index.ts";
import type { Viewer } from "../../../identities/index.ts";
import type { LiveHub } from "../../../live/index.ts";
import { viewerFromRequest } from "./auth-routes.ts";
import type { AuthContext } from "./auth-routes.ts";

const MAX_BODY_BYTES = 65_536;
const SEGMENTS_CARD_CHAT = 4;
const RADIX = 10;
const DIGITS_ONLY = /^\d+$/;
const STATUS_OK = 200;
const STATUS_CREATED = 201;
const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;
const STATUS_FORBIDDEN = 403;
const STATUS_NOT_FOUND = 404;
const STATUS_METHOD_NOT_ALLOWED = 405;
const STATUS_PAYLOAD_TOO_LARGE = 413;
const STATUS_UNAVAILABLE = 503;

type JsonBodyOutcome = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string };

export function isCardChatPath(pathname: string): boolean {
  const segments = pathname.split("/").filter((part) => part !== "");
  return (
    segments.length === SEGMENTS_CARD_CHAT &&
    segments[0] === "v1" &&
    segments[1] === "cards" &&
    segments[3] === "messages"
  );
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wireChatEntry(entry: ChatEntry): Record<string, unknown> {
  return {
    id: entry.id,
    cardId: entry.cardId,
    seq: entry.seq,
    parentId: entry.replyToId,
    authorId: entry.authorId,
    authorLogin: entry.authorLogin,
    text: entry.text,
    mentionsWaiter: entry.mentionsWaiter,
    createdAt: entry.createdAt,
  };
}

function readJsonBody(req: IncomingMessage): Promise<JsonBodyOutcome> {
  return new Promise<JsonBodyOutcome>((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let oversized = false;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        oversized = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", rejectBody);
    req.on("end", () => {
      if (oversized) {
        resolveBody({ ok: false, status: STATUS_PAYLOAD_TOO_LARGE, error: "request body too large" });
        return;
      }
      const text = Buffer.concat(chunks).toString("utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        resolveBody({ ok: false, status: STATUS_BAD_REQUEST, error: "invalid json" });
        return;
      }
      if (!isRecord(parsed)) {
        resolveBody({ ok: false, status: STATUS_BAD_REQUEST, error: "json body must be an object" });
        return;
      }
      resolveBody({ ok: true, body: parsed });
    });
  });
}

function parseAfterSeq(raw: string | null): number | null {
  if (raw === null || raw === "") return 0;
  if (!DIGITS_ONLY.test(raw)) return null;
  const parsed = Number.parseInt(raw, RADIX);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function listChatReply(chat: ChatService, viewer: Viewer, cardId: CardId, url: URL, res: ServerResponse): void {
  const afterSeq = parseAfterSeq(url.searchParams.get("after"));
  if (afterSeq === null) {
    sendJson(res, STATUS_BAD_REQUEST, { ok: false, error: "invalid after cursor" });
    return;
  }
  const outcome = chat.listEntries(viewer, { cardId, afterSeq });
  if (!outcome.ok) {
    const status = outcome.reason === "forbidden" ? STATUS_FORBIDDEN : STATUS_NOT_FOUND;
    const error = outcome.reason === "forbidden" ? "forbidden" : "card not found";
    sendJson(res, status, { ok: false, error });
    return;
  }
  sendJson(res, STATUS_OK, { ok: true, messages: outcome.entries.map((entry) => wireChatEntry(entry)) });
}

async function postChatReply(
  cards: CardService,
  chat: ChatService,
  live: LiveHub | null,
  viewer: Viewer,
  cardId: CardId,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) {
    sendJson(res, parsed.status, { ok: false, error: parsed.error });
    return;
  }
  const text = parsed.body["text"];
  if (typeof text !== "string") {
    sendJson(res, STATUS_BAD_REQUEST, { ok: false, error: "text is required" });
    return;
  }
  const rawReplyTo = parsed.body["parentId"];
  let replyToId: ChatEntryId | null = null;
  if (rawReplyTo !== undefined && rawReplyTo !== null) {
    if (typeof rawReplyTo !== "string" || !isChatEntryId(rawReplyTo)) {
      sendJson(res, STATUS_BAD_REQUEST, { ok: false, error: "invalid parentId" });
      return;
    }
    replyToId = rawReplyTo;
  }
  const outcome = chat.postEntry(viewer, { cardId, text, replyToId });
  if (!outcome.ok) {
    if (outcome.reason === "forbidden") sendJson(res, STATUS_FORBIDDEN, { ok: false, error: "forbidden" });
    else if (outcome.reason === "not-found") sendJson(res, STATUS_NOT_FOUND, { ok: false, error: "card not found" });
    else if (outcome.reason === "empty-text") {
      sendJson(res, STATUS_BAD_REQUEST, { ok: false, error: "text must not be empty" });
    } else sendJson(res, STATUS_BAD_REQUEST, { ok: false, error: "invalid parentId" });
    return;
  }
  const wire = wireChatEntry(outcome.entry);
  live?.broadcast(cards.listMemberIds(cardId), "message_created", { message: wire });
  sendJson(res, STATUS_CREATED, { ok: true, message: wire });
}

export async function routeChat(
  auth: AuthContext | null,
  cards: CardService | null,
  chat: ChatService | null,
  live: LiveHub | null,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (auth === null || cards === null || chat === null) {
    sendJson(res, STATUS_UNAVAILABLE, { ok: false, error: "chat is not configured" });
    return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, STATUS_METHOD_NOT_ALLOWED, { ok: false, error: "method not allowed" });
    return;
  }
  const viewer = viewerFromRequest(auth, req);
  if (viewer === null) {
    sendJson(res, STATUS_UNAUTHORIZED, { ok: false, error: "unauthorized" });
    return;
  }
  const segments = url.pathname.split("/").filter((part) => part !== "");
  const cardSegment = segments[2];
  if (cardSegment === undefined || !isCardId(cardSegment)) {
    sendJson(res, STATUS_NOT_FOUND, { ok: false, error: "card not found" });
    return;
  }
  if (req.method === "GET") {
    listChatReply(chat, viewer, cardSegment, url, res);
    return;
  }
  await postChatReply(cards, chat, live, viewer, cardSegment, req, res);
}
