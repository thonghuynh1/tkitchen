import type { IncomingMessage, ServerResponse } from "node:http";
import { isCardColumn, isCardId, isInviteToken } from "../../../cards/index.ts";
import type { CardService } from "../../../cards/index.ts";
import { isUserId } from "../../../identities/index.ts";
import type { Viewer } from "../../../identities/index.ts";
import type { LiveHub } from "../../../live/index.ts";
import { viewerFromRequest } from "./auth-routes.ts";
import type { AuthContext } from "./auth-routes.ts";

const CARDS_PATH = "/v1/cards";
const CARDS_PREFIX = "/v1/cards/";
const INVITES_PREFIX = "/v1/invites/";
const MAX_BODY_BYTES = 65_536;
const SEGMENTS_COLLECTION = 2;
const SEGMENTS_CARD = 3;
const SEGMENTS_ACTION = 4;
const SEGMENTS_MEMBER = 5;
const STATUS_OK = 200;
const STATUS_CREATED = 201;
const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;
const STATUS_FORBIDDEN = 403;
const STATUS_NOT_FOUND = 404;
const STATUS_METHOD_NOT_ALLOWED = 405;
const STATUS_GONE = 410;
const STATUS_PAYLOAD_TOO_LARGE = 413;
const STATUS_UNAVAILABLE = 503;

type JsonBodyOutcome = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string };

type MatchedRoute =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "move"; cardSegment: string }
  | { kind: "invite"; cardSegment: string }
  | { kind: "redeem"; tokenSegment: string }
  | { kind: "remove-member"; cardSegment: string; userSegment: string }
  | { kind: "close-sharing"; cardSegment: string }
  | { kind: "archive"; cardSegment: string }
  | { kind: "method-not-allowed" }
  | { kind: "not-found" };

export function isCardsPath(pathname: string): boolean {
  return pathname === CARDS_PATH || pathname.startsWith(CARDS_PREFIX) || pathname.startsWith(INVITES_PREFIX);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function matchCardAction(method: string | undefined, cardSegment: string, action: string | undefined): MatchedRoute {
  if (action === "column") return method === "PATCH" ? { kind: "move", cardSegment } : { kind: "method-not-allowed" };
  if (action === "invite") return method === "POST" ? { kind: "invite", cardSegment } : { kind: "method-not-allowed" };
  if (action === "close-sharing") {
    return method === "POST" ? { kind: "close-sharing", cardSegment } : { kind: "method-not-allowed" };
  }
  return { kind: "not-found" };
}

function matchCardsRoute(method: string | undefined, segments: readonly string[]): MatchedRoute {
  const [, , cardSegment, fourth, userSegment] = segments;
  if (segments.length === SEGMENTS_COLLECTION) {
    if (method === "GET") return { kind: "list" };
    if (method === "POST") return { kind: "create" };
    return { kind: "method-not-allowed" };
  }
  if (cardSegment === undefined) return { kind: "not-found" };
  if (segments.length === SEGMENTS_CARD) {
    return method === "DELETE" ? { kind: "archive", cardSegment } : { kind: "method-not-allowed" };
  }
  if (segments.length === SEGMENTS_ACTION) return matchCardAction(method, cardSegment, fourth);
  if (segments.length === SEGMENTS_MEMBER && fourth === "members" && userSegment !== undefined) {
    return method === "DELETE" ? { kind: "remove-member", cardSegment, userSegment } : { kind: "method-not-allowed" };
  }
  return { kind: "not-found" };
}

function matchRoute(method: string | undefined, pathname: string): MatchedRoute {
  const segments = pathname.split("/").filter((part) => part !== "");
  const [version, root, third, fourth] = segments;
  if (version !== "v1") return { kind: "not-found" };
  if (root === "cards") return matchCardsRoute(method, segments);
  if (root === "invites" && segments.length === SEGMENTS_ACTION && third !== undefined && fourth === "redeem") {
    return method === "POST" ? { kind: "redeem", tokenSegment: third } : { kind: "method-not-allowed" };
  }
  return { kind: "not-found" };
}

function decodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

async function createCardReply(
  cards: CardService,
  live: LiveHub | null,
  viewer: Viewer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!viewer.isOwner) {
    sendJson(res, STATUS_FORBIDDEN, { ok: false, error: "forbidden" });
    return;
  }
  const parsed = await readJsonBody(req);
  if (!parsed.ok) {
    sendJson(res, parsed.status, { ok: false, error: parsed.error });
    return;
  }
  const title = parsed.body["title"];
  if (typeof title !== "string") {
    sendJson(res, STATUS_BAD_REQUEST, { ok: false, error: "title is required" });
    return;
  }
  const outcome = cards.createCard(viewer, { title });
  if (!outcome.ok) {
    const status = outcome.reason === "forbidden" ? STATUS_FORBIDDEN : STATUS_BAD_REQUEST;
    const error = outcome.reason === "forbidden" ? "forbidden" : "title must not be empty";
    sendJson(res, status, { ok: false, error });
    return;
  }
  live?.broadcast(outcome.card.memberIds, "card_created", { card: outcome.card });
  sendJson(res, STATUS_CREATED, { ok: true, card: outcome.card });
}

async function moveCardReply(
  cards: CardService,
  live: LiveHub | null,
  viewer: Viewer,
  cardSegment: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) {
    sendJson(res, parsed.status, { ok: false, error: parsed.error });
    return;
  }
  const column = parsed.body["column"];
  if (!isCardColumn(column)) {
    sendJson(res, STATUS_BAD_REQUEST, { ok: false, error: "invalid column" });
    return;
  }
  if (!isCardId(cardSegment)) {
    sendJson(res, STATUS_NOT_FOUND, { ok: false, error: "card not found" });
    return;
  }
  const outcome = cards.moveCard(viewer, { cardId: cardSegment, column });
  if (!outcome.ok) {
    const status = outcome.reason === "forbidden" ? STATUS_FORBIDDEN : STATUS_NOT_FOUND;
    const error = outcome.reason === "forbidden" ? "forbidden" : "card not found";
    sendJson(res, status, { ok: false, error });
    return;
  }
  live?.broadcast(outcome.card.memberIds, "card_moved", { cardId: outcome.card.id, column: outcome.card.column });
  sendJson(res, STATUS_OK, { ok: true, card: outcome.card });
}

function inviteReply(
  auth: AuthContext,
  cards: CardService,
  viewer: Viewer,
  cardSegment: string,
  res: ServerResponse,
): void {
  if (!viewer.isOwner) {
    sendJson(res, STATUS_FORBIDDEN, { ok: false, error: "forbidden" });
    return;
  }
  if (!isCardId(cardSegment)) {
    sendJson(res, STATUS_NOT_FOUND, { ok: false, error: "card not found" });
    return;
  }
  const outcome = cards.getOrCreateInvite(viewer, { cardId: cardSegment });
  if (!outcome.ok) {
    const status = outcome.reason === "forbidden" ? STATUS_FORBIDDEN : STATUS_NOT_FOUND;
    const error = outcome.reason === "forbidden" ? "forbidden" : "card not found";
    sendJson(res, status, { ok: false, error });
    return;
  }
  sendJson(res, STATUS_OK, {
    ok: true,
    token: outcome.invite.token,
    url: auth.publicUrl + "/invite/" + outcome.invite.token,
  });
}

function redeemReply(cards: CardService, viewer: Viewer, tokenSegment: string, res: ServerResponse): void {
  if (!isInviteToken(tokenSegment)) {
    sendJson(res, STATUS_GONE, { ok: false, error: "invite is no longer valid" });
    return;
  }
  const outcome = cards.redeemInvite(viewer, { token: tokenSegment });
  if (!outcome.ok) {
    sendJson(res, STATUS_GONE, { ok: false, error: "invite is no longer valid" });
    return;
  }
  sendJson(res, STATUS_OK, { ok: true, card: outcome.card });
}

function removeMemberReply(
  cards: CardService,
  live: LiveHub | null,
  viewer: Viewer,
  cardSegment: string,
  userSegment: string,
  res: ServerResponse,
): void {
  if (!viewer.isOwner) {
    sendJson(res, STATUS_FORBIDDEN, { ok: false, error: "forbidden" });
    return;
  }
  const decodedUser = decodeSegment(userSegment);
  if (decodedUser === null || !isUserId(decodedUser)) {
    sendJson(res, STATUS_BAD_REQUEST, { ok: false, error: "invalid user id" });
    return;
  }
  if (!isCardId(cardSegment)) {
    sendJson(res, STATUS_NOT_FOUND, { ok: false, error: "card not found" });
    return;
  }
  const outcome = cards.removeMember(viewer, { cardId: cardSegment, memberId: decodedUser });
  if (!outcome.ok) {
    if (outcome.reason === "forbidden") sendJson(res, STATUS_FORBIDDEN, { ok: false, error: "forbidden" });
    else if (outcome.reason === "cannot-remove-owner") {
      sendJson(res, STATUS_BAD_REQUEST, { ok: false, error: "cannot remove owner" });
    } else sendJson(res, STATUS_NOT_FOUND, { ok: false, error: "card not found" });
    return;
  }
  live?.revokeCardAccess(outcome.card.id, outcome.removedUserIds);
  sendJson(res, STATUS_OK, { ok: true, removedUserId: outcome.removedUserId });
}

function closeSharingReply(
  cards: CardService,
  live: LiveHub | null,
  viewer: Viewer,
  cardSegment: string,
  res: ServerResponse,
): void {
  if (!viewer.isOwner) {
    sendJson(res, STATUS_FORBIDDEN, { ok: false, error: "forbidden" });
    return;
  }
  if (!isCardId(cardSegment)) {
    sendJson(res, STATUS_NOT_FOUND, { ok: false, error: "card not found" });
    return;
  }
  const outcome = cards.closeSharing(viewer, { cardId: cardSegment });
  if (!outcome.ok) {
    const status = outcome.reason === "forbidden" ? STATUS_FORBIDDEN : STATUS_NOT_FOUND;
    const error = outcome.reason === "forbidden" ? "forbidden" : "card not found";
    sendJson(res, status, { ok: false, error });
    return;
  }
  live?.revokeCardAccess(outcome.card.id, outcome.removedUserIds);
  sendJson(res, STATUS_OK, { ok: true, removedUserIds: outcome.removedUserIds });
}

function archiveCardReply(
  cards: CardService,
  live: LiveHub | null,
  viewer: Viewer,
  cardSegment: string,
  res: ServerResponse,
): void {
  if (!viewer.isOwner) {
    sendJson(res, STATUS_FORBIDDEN, { ok: false, error: "forbidden" });
    return;
  }
  if (!isCardId(cardSegment)) {
    sendJson(res, STATUS_NOT_FOUND, { ok: false, error: "card not found" });
    return;
  }
  const outcome = cards.archiveCard(viewer, { cardId: cardSegment });
  if (!outcome.ok) {
    const status = outcome.reason === "forbidden" ? STATUS_FORBIDDEN : STATUS_NOT_FOUND;
    const error = outcome.reason === "forbidden" ? "forbidden" : "card not found";
    sendJson(res, status, { ok: false, error });
    return;
  }
  live?.revokeCardAccess(outcome.card.id, outcome.removedUserIds);
  live?.broadcast([viewer.user.id], "card_removed", { cardId: outcome.card.id });
  sendJson(res, STATUS_OK, { ok: true, archivedAt: outcome.archivedAt, removedUserIds: outcome.removedUserIds });
}

export async function routeCards(
  auth: AuthContext | null,
  cards: CardService | null,
  live: LiveHub | null,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (auth === null || cards === null) {
    sendJson(res, STATUS_UNAVAILABLE, { ok: false, error: "cards are not configured" });
    return;
  }
  const matched = matchRoute(req.method, url.pathname);
  if (matched.kind === "not-found") {
    sendJson(res, STATUS_NOT_FOUND, { ok: false, error: "not found" });
    return;
  }
  if (matched.kind === "method-not-allowed") {
    sendJson(res, STATUS_METHOD_NOT_ALLOWED, { ok: false, error: "method not allowed" });
    return;
  }
  const viewer = viewerFromRequest(auth, req);
  if (viewer === null) {
    sendJson(res, STATUS_UNAUTHORIZED, { ok: false, error: "unauthorized" });
    return;
  }
  switch (matched.kind) {
    case "list":
      sendJson(res, STATUS_OK, { ok: true, cards: cards.listCards(viewer) });
      return;
    case "create":
      await createCardReply(cards, live, viewer, req, res);
      return;
    case "move":
      await moveCardReply(cards, live, viewer, matched.cardSegment, req, res);
      return;
    case "invite":
      inviteReply(auth, cards, viewer, matched.cardSegment, res);
      return;
    case "redeem":
      redeemReply(cards, viewer, matched.tokenSegment, res);
      return;
    case "remove-member":
      removeMemberReply(cards, live, viewer, matched.cardSegment, matched.userSegment, res);
      return;
    case "close-sharing":
      closeSharingReply(cards, live, viewer, matched.cardSegment, res);
      return;
    case "archive":
      archiveCardReply(cards, live, viewer, matched.cardSegment, res);
      return;
  }
}
