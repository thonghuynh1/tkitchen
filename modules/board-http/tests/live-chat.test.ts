import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteCardStore } from "../../cards/adapters.ts";
import { CardService } from "../../cards/index.ts";
import { SqliteChatStore } from "../../chat/adapters.ts";
import { ChatService } from "../../chat/index.ts";
import { SqliteIdentityStore } from "../../identities/adapters.ts";
import { IdentityService, userIdFromGithub } from "../../identities/index.ts";
import type { GitHubOAuthPort, GitHubProfile } from "../../identities/index.ts";
import { InMemoryLiveHub } from "../../live/index.ts";
import { startBoardServer } from "../adapters.ts";
import type { BoardServer } from "../index.ts";

const PUBLIC_URL = "https://board.example.test";

class FakeGitHub implements GitHubOAuthPort {
  constructor(private readonly profiles: Record<string, GitHubProfile>) {}
  authorizeUrl(input: { state: string; redirectUri: string }): string {
    const params = new URLSearchParams({ state: input.state, redirect_uri: input.redirectUri });
    return "https://github.test/authorize?" + params.toString();
  }
  exchangeCode(input: { code: string }): Promise<GitHubProfile> {
    const profile = this.profiles[input.code];
    return profile === undefined ? Promise.reject(new Error("bad code")) : Promise.resolve(profile);
  }
}

class CountingIds {
  private counter: number;
  constructor(start = 0) {
    this.counter = start;
  }
  next(): string {
    this.counter += 1;
    return "00000000-0000-4000-8000-" + String(this.counter).padStart(12, "0");
  }
}

interface SseFrame {
  kind: string;
  data: Record<string, unknown>;
}

interface SseClient {
  nextFrame(): Promise<SseFrame | null>;
  drainUntilEnd(): Promise<SseFrame[]>;
  close(): Promise<void>;
}

const fixedClock = { now: (): Date => new Date(1_700_000_000_000) };

let home: string;
let identityStore: SqliteIdentityStore;
let cardStore: SqliteCardStore;
let chatStore: SqliteChatStore;
let liveHub: InMemoryLiveHub;
let board: BoardServer;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringProp(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") throw new Error("expected string prop " + key);
  return value;
}

function recordProp(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = obj[key];
  if (!isRecord(value)) throw new Error("expected object prop " + key);
  return value;
}

function arrayProp(obj: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = obj[key];
  if (!Array.isArray(value)) throw new Error("expected array prop " + key);
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("expected record array item");
    return item;
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await res.json();
  if (!isRecord(parsed)) throw new Error("expected json object");
  return parsed;
}

function cookieValue(setCookies: string[], name: string): string {
  const found = setCookies.find((c) => c.startsWith(name + "="));
  if (found === undefined) throw new Error("no cookie " + name);
  return found.slice(name.length + 1).split(";")[0] ?? "";
}

async function signIn(code: string): Promise<string> {
  const startRes = await fetch(board.url + "/v1/auth/github?returnTo=%2F", { redirect: "manual" });
  const location = new URL(startRes.headers.get("location") ?? "");
  const state = location.searchParams.get("state") ?? "";
  const set = startRes.headers.getSetCookie();
  const oauthJar =
    "tkitchen_oauth_state=" +
    cookieValue(set, "tkitchen_oauth_state") +
    "; tkitchen_oauth_return=" +
    cookieValue(set, "tkitchen_oauth_return");
  const cbRes = await fetch(board.url + "/v1/auth/github/callback?code=" + code + "&state=" + state, {
    redirect: "manual",
    headers: { cookie: oauthJar },
  });
  return "tkitchen_session=" + cookieValue(cbRes.headers.getSetCookie(), "tkitchen_session");
}

function requestJson(
  path: string,
  options: { method?: string; session?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.session !== undefined) headers["cookie"] = options.session;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return fetch(board.url + path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? null : JSON.stringify(options.body),
  });
}

function parseBlock(block: string): SseFrame | null {
  let kind = "";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":") || line === "") continue;
    if (line.startsWith("event:")) kind = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  if (kind === "" || dataLines.length === 0) return null;
  const parsed: unknown = JSON.parse(dataLines.join("\n"));
  if (!isRecord(parsed)) throw new Error("expected object SSE data");
  return { kind, data: parsed };
}

async function openSse(session: string): Promise<SseClient> {
  const controller = new AbortController();
  const res = await fetch(board.url + "/v1/stream", {
    headers: { cookie: session },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const body = res.body;
  if (body === null) throw new Error("missing SSE body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const queued: SseFrame[] = [];
  let finished = false;

  async function nextFrame(): Promise<SseFrame | null> {
    while (queued.length === 0 && !finished) {
      const chunk = await reader.read();
      if (chunk.done) {
        finished = true;
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      for (;;) {
        const idx = buffer.indexOf("\n\n");
        if (idx === -1) break;
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const frame = parseBlock(block);
        if (frame !== null) queued.push(frame);
      }
    }
    return queued.shift() ?? null;
  }

  async function drainUntilEnd(): Promise<SseFrame[]> {
    const frames: SseFrame[] = [];
    for (;;) {
      const frame = await nextFrame();
      if (frame === null) break;
      frames.push(frame);
    }
    return frames;
  }

  async function close(): Promise<void> {
    finished = true;
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }

  return { nextFrame, drainUntilEnd, close };
}

async function startStack(dbPath: string, idStart = 0): Promise<void> {
  identityStore = new SqliteIdentityStore(dbPath);
  cardStore = new SqliteCardStore(dbPath);
  chatStore = new SqliteChatStore(dbPath);
  liveHub = new InMemoryLiveHub();
  const identities = new IdentityService({
    store: identityStore,
    oauth: new FakeGitHub({
      owner: { githubId: 1, login: "owner" },
      alice: { githubId: 2, login: "alice" },
      charlie: { githubId: 3, login: "charlie" },
      bob: { githubId: 4, login: "bob" },
    }),
    clock: fixedClock,
    ids: new CountingIds(idStart),
    ownerId: userIdFromGithub(1),
  });
  const cards = new CardService({ store: cardStore, clock: fixedClock, ids: new CountingIds(idStart) });
  const chat = new ChatService({
    store: chatStore,
    cards: cardStore,
    clock: fixedClock,
    ids: new CountingIds(idStart),
  });
  board = await startBoardServer({
    port: 0,
    host: "127.0.0.1",
    webRoot: home,
    publicUrl: PUBLIC_URL,
    identities,
    cards,
    chat,
    live: liveHub,
  });
}

async function createSharedCard(
  ownerSession: string,
  memberSessions: string[],
): Promise<{ cardId: string; inviteToken: string }> {
  const created = await readJson(
    await requestJson("/v1/cards", { method: "POST", session: ownerSession, body: { title: "Live Card" } }),
  );
  const cardId = stringProp(recordProp(created, "card"), "id");
  const invite = await readJson(
    await requestJson("/v1/cards/" + cardId + "/invite", { method: "POST", session: ownerSession }),
  );
  const inviteToken = stringProp(invite, "token");
  for (const session of memberSessions) {
    const redeem = await requestJson("/v1/invites/" + inviteToken + "/redeem", { method: "POST", session });
    expect(redeem.status).toBe(200);
  }
  return { cardId, inviteToken };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "tkitchen-board-live-chat-"));
  await writeFile(join(home, "index.html"), "<h1>board page</h1>\n");
  await startStack(join(home, "board.db"));
});

afterEach(async () => {
  await board.close();
  chatStore.close();
  cardStore.close();
  identityStore.close();
  await rm(home, { recursive: true, force: true });
});

describe("board live chat and SSE", () => {
  it("streams live messages over SSE and catches up missed messages after disconnect", async () => {
    const ownerSession = await signIn("owner");
    const aliceSession = await signIn("alice");
    const bobSession = await signIn("bob");
    const { cardId } = await createSharedCard(ownerSession, [aliceSession]);

    const aliceStream = await openSse(aliceSession);
    const bobStream = await openSse(bobSession);

    const post1 = await requestJson("/v1/cards/" + cardId + "/messages", {
      method: "POST",
      session: ownerSession,
      body: { text: "first live note" },
    });
    expect(post1.status).toBe(201);
    const post1Body = await readJson(post1);
    const firstWire = recordProp(post1Body, "message");
    expect(firstWire["seq"]).toBe(1);
    expect(firstWire["parentId"]).toBeNull();

    const frame1 = await aliceStream.nextFrame();
    expect(frame1).not.toBeNull();
    expect(frame1?.kind).toBe("message_created");
    expect(recordProp(frame1!.data, "message")["seq"]).toBe(1);
    expect(recordProp(frame1!.data, "message")["text"]).toBe("first live note");

    await aliceStream.close();

    const post2 = await requestJson("/v1/cards/" + cardId + "/messages", {
      method: "POST",
      session: ownerSession,
      body: { text: "second while disconnected", parentId: stringProp(firstWire, "id") },
    });
    expect(post2.status).toBe(201);
    const post2Body = await readJson(post2);
    expect(recordProp(post2Body, "message")["seq"]).toBe(2);
    expect(recordProp(post2Body, "message")["parentId"]).toBe(stringProp(firstWire, "id"));

    const catchUpRes = await requestJson("/v1/cards/" + cardId + "/messages?after=1", { session: aliceSession });
    expect(catchUpRes.status).toBe(200);
    const catchUpBody = await readJson(catchUpRes);
    const missed = arrayProp(catchUpBody, "messages");
    expect(missed).toHaveLength(1);
    expect(missed[0]?.["seq"]).toBe(2);
    expect(missed[0]?.["text"]).toBe("second while disconnected");

    const bobGet = await requestJson("/v1/cards/" + cardId + "/messages?after=0", { session: bobSession });
    expect(bobGet.status).toBe(403);
    const bobPost = await requestJson("/v1/cards/" + cardId + "/messages", {
      method: "POST",
      session: bobSession,
      body: { text: "bob should fail" },
    });
    expect(bobPost.status).toBe(403);

    await bobStream.close();
  });

  it("removal, close-sharing, and archive immediately end SSE streams and prevent post-removal leaks", async () => {
    const ownerSession = await signIn("owner");
    const aliceSession = await signIn("alice");
    const charlieSession = await signIn("charlie");

    const card1 = await createSharedCard(ownerSession, [aliceSession, charlieSession]);
    const aliceStream1 = await openSse(aliceSession);
    const charlieStream1 = await openSse(charlieSession);

    const removeRes = await requestJson("/v1/cards/" + card1.cardId + "/members/github:2", {
      method: "DELETE",
      session: ownerSession,
    });
    expect(removeRes.status).toBe(200);

    const postAfterRemove = await requestJson("/v1/cards/" + card1.cardId + "/messages", {
      method: "POST",
      session: ownerSession,
      body: { text: "secret after removal" },
    });
    expect(postAfterRemove.status).toBe(201);

    const aliceFrames1 = await aliceStream1.drainUntilEnd();
    expect(aliceFrames1).toEqual([{ kind: "card_removed", data: { cardId: card1.cardId } }]);
    const charlieFrame1 = await charlieStream1.nextFrame();
    expect(charlieFrame1?.kind).toBe("message_created");
    expect(recordProp(charlieFrame1!.data, "message")["text"]).toBe("secret after removal");

    expect(
      (await requestJson("/v1/cards/" + card1.cardId + "/messages?after=0", { session: aliceSession })).status,
    ).toBe(403);
    expect(
      (
        await requestJson("/v1/cards/" + card1.cardId + "/messages", {
          method: "POST",
          session: aliceSession,
          body: { text: "denied" },
        })
      ).status,
    ).toBe(403);

    const closeSharingRes = await requestJson("/v1/cards/" + card1.cardId + "/close-sharing", {
      method: "POST",
      session: ownerSession,
    });
    expect(closeSharingRes.status).toBe(200);

    await requestJson("/v1/cards/" + card1.cardId + "/messages", {
      method: "POST",
      session: ownerSession,
      body: { text: "secret after close sharing" },
    });

    const charlieFrames1 = await charlieStream1.drainUntilEnd();
    expect(charlieFrames1).toEqual([{ kind: "card_removed", data: { cardId: card1.cardId } }]);
    expect(
      (await requestJson("/v1/cards/" + card1.cardId + "/messages?after=0", { session: charlieSession })).status,
    ).toBe(403);

    const card2 = await createSharedCard(ownerSession, [aliceSession]);
    const aliceStream2 = await openSse(aliceSession);

    const archiveRes = await requestJson("/v1/cards/" + card2.cardId, {
      method: "DELETE",
      session: ownerSession,
    });
    expect(archiveRes.status).toBe(200);

    const aliceFrames2 = await aliceStream2.drainUntilEnd();
    expect(aliceFrames2).toEqual([{ kind: "card_removed", data: { cardId: card2.cardId } }]);
    expect(
      (await requestJson("/v1/cards/" + card2.cardId + "/messages?after=0", { session: aliceSession })).status,
    ).toBe(404);
    expect(
      (await requestJson("/v1/cards/" + card2.cardId + "/messages?after=0", { session: ownerSession })).status,
    ).toBe(404);
  });

  it("persists messages across restart and writes nothing to kitchen.db", async () => {
    const ownerSession = await signIn("owner");
    const { cardId } = await createSharedCard(ownerSession, []);

    const postRes = await requestJson("/v1/cards/" + cardId + "/messages", {
      method: "POST",
      session: ownerSession,
      body: { text: "hey @Waiter, persist this" },
    });
    expect(postRes.status).toBe(201);
    const posted = recordProp(await readJson(postRes), "message");
    expect(posted["mentionsWaiter"]).toBe(true);
    expect(posted["seq"]).toBe(1);

    await board.close();
    chatStore.close();
    cardStore.close();
    identityStore.close();

    await startStack(join(home, "board.db"), 100);

    const listRes = await requestJson("/v1/cards/" + cardId + "/messages", { session: ownerSession });
    expect(listRes.status).toBe(200);
    const listed = arrayProp(await readJson(listRes), "messages");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.["text"]).toBe("hey @Waiter, persist this");
    expect(listed[0]?.["mentionsWaiter"]).toBe(true);
    expect(listed[0]?.["seq"]).toBe(1);

    expect(existsSync(join(home, "board.db"))).toBe(true);
    expect(existsSync(join(home, "kitchen.db"))).toBe(false);
  });

  it("pushes card_created and card_moved over SSE and enforces auth and validation", async () => {
    const ownerSession = await signIn("owner");
    const ownerStream = await openSse(ownerSession);

    const created = await readJson(
      await requestJson("/v1/cards", { method: "POST", session: ownerSession, body: { title: "Move Me" } }),
    );
    const cardId = stringProp(recordProp(created, "card"), "id");

    const createdFrame = await ownerStream.nextFrame();
    expect(createdFrame?.kind).toBe("card_created");
    expect(recordProp(createdFrame!.data, "card")["id"]).toBe(cardId);

    const moveRes = await requestJson("/v1/cards/" + cardId + "/column", {
      method: "PATCH",
      session: ownerSession,
      body: { column: "doing" },
    });
    expect(moveRes.status).toBe(200);

    const movedFrame = await ownerStream.nextFrame();
    expect(movedFrame).toEqual({ kind: "card_moved", data: { cardId, column: "doing" } });

    expect((await requestJson("/v1/stream")).status).toBe(401);
    expect((await requestJson("/v1/stream", { method: "POST", session: ownerSession })).status).toBe(405);
    expect((await requestJson("/v1/cards/" + cardId + "/messages?after=-1", { session: ownerSession })).status).toBe(
      400,
    );
    expect(
      (
        await requestJson("/v1/cards/" + cardId + "/messages", {
          method: "POST",
          session: ownerSession,
          body: { text: "   " },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await requestJson("/v1/cards/" + cardId + "/messages", {
          method: "POST",
          session: ownerSession,
          body: { text: "bad ref", parentId: "00000000-0000-4000-8000-999999999999" },
        })
      ).status,
    ).toBe(400);

    await ownerStream.close();
  });
});
