import {
  parseArchiveCardResponse,
  parseCardSingleResponse,
  parseCardsListResponse,
  parseCloseSharingResponse,
  parseInviteLinkResponse,
  parseRemoveMemberResponse,
} from "../../modules/cards/web";
import type { CardColumn, CardMemberId, WebCard, WebCardId, WebInviteLink } from "../../modules/cards/web";
import { parseChatListResponse, parseChatPostResponse } from "../../modules/chat/web";
import type { WebChatEntry, WebChatEntryId } from "../../modules/chat/web";
import { parseMeResponse } from "../../modules/identities/web";
import type { MeResponse } from "../../modules/identities/web";

export type ApiOutcome<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractError(raw: unknown, fallback: string): string {
  if (isRecord(raw) && typeof raw["error"] === "string") return raw["error"];
  return fallback;
}

export async function fetchMe(): Promise<ApiOutcome<MeResponse>> {
  const response = await fetch("/v1/me", { credentials: "same-origin" });
  const raw = await readJsonSafe(response);
  if (response.status === 401) {
    return { ok: true, data: { ok: false, error: "unauthorized" } };
  }
  const parsed = parseMeResponse(raw);
  if (!response.ok || parsed === null) {
    return { ok: false, status: response.status, error: extractError(raw, "Could not load session") };
  }
  return { ok: true, data: parsed };
}

export async function postLogout(): Promise<void> {
  await fetch("/v1/auth/logout", { method: "POST", credentials: "same-origin" });
}

export async function fetchCards(): Promise<ApiOutcome<WebCard[]>> {
  const response = await fetch("/v1/cards", { credentials: "same-origin" });
  const raw = await readJsonSafe(response);
  const parsed = parseCardsListResponse(raw);
  if (!response.ok || parsed === null) {
    return { ok: false, status: response.status, error: extractError(raw, "Could not load cards") };
  }
  return { ok: true, data: parsed };
}

export async function createCard(title: string): Promise<ApiOutcome<WebCard>> {
  const response = await fetch("/v1/cards", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const raw = await readJsonSafe(response);
  const parsed = parseCardSingleResponse(raw);
  if (!response.ok || parsed === null) {
    return { ok: false, status: response.status, error: extractError(raw, "Could not create card") };
  }
  return { ok: true, data: parsed };
}

export async function moveCard(cardId: WebCardId, column: CardColumn): Promise<ApiOutcome<WebCard>> {
  const response = await fetch("/v1/cards/" + encodeURIComponent(cardId) + "/column", {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ column }),
  });
  const raw = await readJsonSafe(response);
  const parsed = parseCardSingleResponse(raw);
  if (!response.ok || parsed === null) {
    return { ok: false, status: response.status, error: extractError(raw, "Could not move card") };
  }
  return { ok: true, data: parsed };
}

export async function createInviteLink(cardId: WebCardId): Promise<ApiOutcome<WebInviteLink>> {
  const response = await fetch("/v1/cards/" + encodeURIComponent(cardId) + "/invite", {
    method: "POST",
    credentials: "same-origin",
  });
  const raw = await readJsonSafe(response);
  const parsed = parseInviteLinkResponse(raw);
  if (!response.ok || parsed === null) {
    return { ok: false, status: response.status, error: extractError(raw, "Could not create invite link") };
  }
  return { ok: true, data: parsed };
}

export async function redeemInvite(token: string): Promise<ApiOutcome<WebCard>> {
  const response = await fetch("/v1/invites/" + encodeURIComponent(token) + "/redeem", {
    method: "POST",
    credentials: "same-origin",
  });
  const raw = await readJsonSafe(response);
  const parsed = parseCardSingleResponse(raw);
  if (!response.ok || parsed === null) {
    return { ok: false, status: response.status, error: extractError(raw, "This invite link is no longer valid") };
  }
  return { ok: true, data: parsed };
}

export async function removeCardMember(cardId: WebCardId, memberId: CardMemberId): Promise<ApiOutcome<CardMemberId>> {
  const response = await fetch("/v1/cards/" + encodeURIComponent(cardId) + "/members/" + encodeURIComponent(memberId), {
    method: "DELETE",
    credentials: "same-origin",
  });
  const raw = await readJsonSafe(response);
  const parsed = parseRemoveMemberResponse(raw);
  if (!response.ok || parsed === null) {
    return { ok: false, status: response.status, error: extractError(raw, "Could not remove member") };
  }
  return { ok: true, data: parsed };
}

export async function closeCardSharing(cardId: WebCardId): Promise<ApiOutcome<CardMemberId[]>> {
  const response = await fetch("/v1/cards/" + encodeURIComponent(cardId) + "/close-sharing", {
    method: "POST",
    credentials: "same-origin",
  });
  const raw = await readJsonSafe(response);
  const parsed = parseCloseSharingResponse(raw);
  if (!response.ok || parsed === null) {
    return { ok: false, status: response.status, error: extractError(raw, "Could not close sharing") };
  }
  return { ok: true, data: parsed };
}

export async function deleteCard(cardId: WebCardId): Promise<ApiOutcome<string>> {
  const response = await fetch("/v1/cards/" + encodeURIComponent(cardId), {
    method: "DELETE",
    credentials: "same-origin",
  });
  const raw = await readJsonSafe(response);
  const parsed = parseArchiveCardResponse(raw);
  if (!response.ok || parsed === null) {
    return { ok: false, status: response.status, error: extractError(raw, "Could not delete card") };
  }
  return { ok: true, data: parsed.archivedAt };
}

export async function fetchChatEntries(cardId: WebCardId, afterSeq = 0): Promise<ApiOutcome<WebChatEntry[]>> {
  const response = await fetch(
    "/v1/cards/" + encodeURIComponent(cardId) + "/messages?after=" + encodeURIComponent(String(afterSeq)),
    { credentials: "same-origin" },
  );
  const raw = await readJsonSafe(response);
  const parsed = parseChatListResponse(raw);
  if (!response.ok || parsed === null) {
    return { ok: false, status: response.status, error: extractError(raw, "Could not load chat") };
  }
  return { ok: true, data: parsed };
}

export async function postChatEntry(input: {
  cardId: WebCardId;
  text: string;
  replyToId: WebChatEntryId | null;
}): Promise<ApiOutcome<WebChatEntry>> {
  const payload = input.replyToId === null ? { text: input.text } : { text: input.text, parentId: input.replyToId };
  const response = await fetch("/v1/cards/" + encodeURIComponent(input.cardId) + "/messages", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await readJsonSafe(response);
  const parsed = parseChatPostResponse(raw);
  if (!response.ok || parsed === null) {
    return { ok: false, status: response.status, error: extractError(raw, "Could not send chat entry") };
  }
  return { ok: true, data: parsed };
}
