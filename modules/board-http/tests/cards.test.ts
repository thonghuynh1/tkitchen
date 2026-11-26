import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteCardStore } from "../../cards/adapters.ts";
import { CardService } from "../../cards/index.ts";
import { SqliteIdentityStore } from "../../identities/adapters.ts";
import { IdentityService, userIdFromGithub } from "../../identities/index.ts";
import type { GitHubOAuthPort, GitHubProfile } from "../../identities/index.ts";
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
  private counter = 0;
  next(): string {
    this.counter += 1;
    return "00000000-0000-4000-8000-" + String(this.counter).padStart(12, "0");
  }
}

const fixedClock = { now: (): Date => new Date(1_700_000_000_000) };

let home: string;
let identityStore: SqliteIdentityStore;
let cardStore: SqliteCardStore;
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

function archivedAtInDb(rawCard: string): string | null {
  const db = new DatabaseSync(join(home, "board.db"));
  try {
    const row = db.prepare("SELECT archived_at FROM cards WHERE id = ?").get(rawCard);
    if (row === undefined) throw new Error("card row missing");
    const value = row["archived_at"];
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") throw new Error("unexpected archived_at type");
    return value;
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "tkitchen-board-cards-"));
  await writeFile(join(home, "index.html"), "<h1>board page</h1>\n");
  const dbPath = join(home, "board.db");
  identityStore = new SqliteIdentityStore(dbPath);
  cardStore = new SqliteCardStore(dbPath);
  const identities = new IdentityService({
    store: identityStore,
    oauth: new FakeGitHub({
      owner: { githubId: 1, login: "owner" },
      alice: { githubId: 2, login: "alice" },
      charlie: { githubId: 3, login: "charlie" },
      bob: { githubId: 4, login: "bob" },
    }),
    clock: fixedClock,
    ids: new CountingIds(),
    ownerId: userIdFromGithub(1),
  });
  const cards = new CardService({
    store: cardStore,
    clock: fixedClock,
    ids: new CountingIds(),
  });
  board = await startBoardServer({
    port: 0,
    host: "127.0.0.1",
    webRoot: home,
    publicUrl: PUBLIC_URL,
    identities,
    cards,
  });
});

afterEach(async () => {
  await board.close();
  cardStore.close();
  identityStore.close();
  await rm(home, { recursive: true, force: true });
});

describe("board cards HTTP", () => {
  it("owner creates card, multi-use invite admits Alice and Charlie, stranger Bob is denied", async () => {
    const ownerSession = await signIn("owner");
    const aliceSession = await signIn("alice");
    const charlieSession = await signIn("charlie");
    const bobSession = await signIn("bob");

    const bobCreate = await requestJson("/v1/cards", {
      method: "POST",
      session: bobSession,
      body: { title: "Bob tries" },
    });
    expect(bobCreate.status).toBe(403);
    const ownerBefore = await readJson(await requestJson("/v1/cards", { session: ownerSession }));
    expect(ownerBefore["cards"]).toEqual([]);

    const createRes = await requestJson("/v1/cards", {
      method: "POST",
      session: ownerSession,
      body: { title: "Card 1" },
    });
    expect(createRes.status).toBe(201);
    const createdBody = await readJson(createRes);
    const card = recordProp(createdBody, "card");
    const cardId = stringProp(card, "id");
    expect(card["title"]).toBe("Card 1");
    expect(card["column"]).toBe("todo");

    const inviteRes = await requestJson("/v1/cards/" + cardId + "/invite", {
      method: "POST",
      session: ownerSession,
    });
    expect(inviteRes.status).toBe(200);
    const inviteBody = await readJson(inviteRes);
    const token1 = stringProp(inviteBody, "token");
    expect(inviteBody["url"]).toBe(PUBLIC_URL + "/invite/" + token1);

    const aliceRedeem = await requestJson("/v1/invites/" + token1 + "/redeem", {
      method: "POST",
      session: aliceSession,
    });
    expect(aliceRedeem.status).toBe(200);

    const charlieRedeem = await requestJson("/v1/invites/" + token1 + "/redeem", {
      method: "POST",
      session: charlieSession,
    });
    expect(charlieRedeem.status).toBe(200);

    const aliceList = await readJson(await requestJson("/v1/cards", { session: aliceSession }));
    const charlieList = await readJson(await requestJson("/v1/cards", { session: charlieSession }));
    const bobList = await readJson(await requestJson("/v1/cards", { session: bobSession }));
    expect(aliceList["cards"]).toHaveLength(1);
    expect(charlieList["cards"]).toHaveLength(1);
    expect(bobList["cards"]).toEqual([]);

    const bobMove = await requestJson("/v1/cards/" + cardId + "/column", {
      method: "PATCH",
      session: bobSession,
      body: { column: "doing" },
    });
    expect(bobMove.status).toBe(403);

    const aliceMove = await requestJson("/v1/cards/" + cardId + "/column", {
      method: "PATCH",
      session: aliceSession,
      body: { column: "doing" },
    });
    expect(aliceMove.status).toBe(200);
    const movedBody = await readJson(aliceMove);
    expect(recordProp(movedBody, "card")["column"]).toBe("doing");
  });

  it("removing Alice revokes active invite while keeping Charlie, and fresh invite allows rejoin", async () => {
    const ownerSession = await signIn("owner");
    const aliceSession = await signIn("alice");
    const charlieSession = await signIn("charlie");

    const createdBody = await readJson(
      await requestJson("/v1/cards", { method: "POST", session: ownerSession, body: { title: "Card 1" } }),
    );
    const cardId = stringProp(recordProp(createdBody, "card"), "id");

    const inv1Body = await readJson(
      await requestJson("/v1/cards/" + cardId + "/invite", { method: "POST", session: ownerSession }),
    );
    const token1 = stringProp(inv1Body, "token");

    expect(
      (await requestJson("/v1/invites/" + token1 + "/redeem", { method: "POST", session: aliceSession })).status,
    ).toBe(200);
    expect(
      (await requestJson("/v1/invites/" + token1 + "/redeem", { method: "POST", session: charlieSession })).status,
    ).toBe(200);

    const removeRes = await requestJson("/v1/cards/" + cardId + "/members/github:2", {
      method: "DELETE",
      session: ownerSession,
    });
    expect(removeRes.status).toBe(200);
    expect(await readJson(removeRes)).toEqual({ ok: true, removedUserId: "github:2" });

    const aliceMove = await requestJson("/v1/cards/" + cardId + "/column", {
      method: "PATCH",
      session: aliceSession,
      body: { column: "doing" },
    });
    expect(aliceMove.status).toBe(403);

    const aliceReplay = await requestJson("/v1/invites/" + token1 + "/redeem", {
      method: "POST",
      session: aliceSession,
    });
    expect(aliceReplay.status).toBe(410);

    const charlieList = await readJson(await requestJson("/v1/cards", { session: charlieSession }));
    expect(charlieList["cards"]).toHaveLength(1);

    const inv2Body = await readJson(
      await requestJson("/v1/cards/" + cardId + "/invite", { method: "POST", session: ownerSession }),
    );
    const token2 = stringProp(inv2Body, "token");
    expect(token2).not.toBe(token1);

    const aliceRejoin = await requestJson("/v1/invites/" + token2 + "/redeem", {
      method: "POST",
      session: aliceSession,
    });
    expect(aliceRejoin.status).toBe(200);
  });

  it("close sharing kicks all non-owners and soft-delete archives card while keeping SQLite row", async () => {
    const ownerSession = await signIn("owner");
    const aliceSession = await signIn("alice");
    const charlieSession = await signIn("charlie");

    const createdBody = await readJson(
      await requestJson("/v1/cards", { method: "POST", session: ownerSession, body: { title: "Card 1" } }),
    );
    const cardId = stringProp(recordProp(createdBody, "card"), "id");

    const inv2Body = await readJson(
      await requestJson("/v1/cards/" + cardId + "/invite", { method: "POST", session: ownerSession }),
    );
    const token2 = stringProp(inv2Body, "token");
    await requestJson("/v1/invites/" + token2 + "/redeem", { method: "POST", session: aliceSession });
    await requestJson("/v1/invites/" + token2 + "/redeem", { method: "POST", session: charlieSession });

    const closeRes = await requestJson("/v1/cards/" + cardId + "/close-sharing", {
      method: "POST",
      session: ownerSession,
    });
    expect(closeRes.status).toBe(200);
    const closeBody = await readJson(closeRes);
    expect(closeBody).toEqual({ ok: true, removedUserIds: ["github:2", "github:3"] });

    expect(
      (await requestJson("/v1/invites/" + token2 + "/redeem", { method: "POST", session: aliceSession })).status,
    ).toBe(410);

    const aliceDelete = await requestJson("/v1/cards/" + cardId, { method: "DELETE", session: aliceSession });
    expect(aliceDelete.status).toBe(403);
    expect(archivedAtInDb(cardId)).toBeNull();

    const inv3Body = await readJson(
      await requestJson("/v1/cards/" + cardId + "/invite", { method: "POST", session: ownerSession }),
    );
    const token3 = stringProp(inv3Body, "token");

    const ownerDelete = await requestJson("/v1/cards/" + cardId, { method: "DELETE", session: ownerSession });
    expect(ownerDelete.status).toBe(200);
    const deleteBody = await readJson(ownerDelete);
    const archivedAt = stringProp(deleteBody, "archivedAt");
    expect(archivedAtInDb(cardId)).toBe(archivedAt);

    const ownerList = await readJson(await requestJson("/v1/cards", { session: ownerSession }));
    expect(ownerList["cards"]).toEqual([]);

    expect(
      (
        await requestJson("/v1/cards/" + cardId + "/column", {
          method: "PATCH",
          session: ownerSession,
          body: { column: "done" },
        })
      ).status,
    ).toBe(404);
    expect(
      (await requestJson("/v1/cards/" + cardId + "/invite", { method: "POST", session: ownerSession })).status,
    ).toBe(404);
    expect(
      (await requestJson("/v1/cards/" + cardId + "/members/github:2", { method: "DELETE", session: ownerSession }))
        .status,
    ).toBe(404);
    expect(
      (await requestJson("/v1/cards/" + cardId + "/close-sharing", { method: "POST", session: ownerSession })).status,
    ).toBe(404);
    expect(
      (await requestJson("/v1/invites/" + token3 + "/redeem", { method: "POST", session: aliceSession })).status,
    ).toBe(410);
  });

  it("enforces auth, validation, methods, 503 when unconfigured, and never creates kitchen.db", async () => {
    const ownerSession = await signIn("owner");
    const createdBody = await readJson(
      await requestJson("/v1/cards", { method: "POST", session: ownerSession, body: { title: "Edge" } }),
    );
    const cardId = stringProp(recordProp(createdBody, "card"), "id");

    expect((await requestJson("/v1/cards")).status).toBe(401);
    expect((await requestJson("/v1/cards", { method: "POST", body: { title: "x" } })).status).toBe(401);

    expect(
      (await requestJson("/v1/cards", { method: "POST", session: ownerSession, body: { title: "   " } })).status,
    ).toBe(400);
    expect(
      (
        await requestJson("/v1/cards/" + cardId + "/column", {
          method: "PATCH",
          session: ownerSession,
          body: { column: "invalid" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await requestJson("/v1/cards/" + cardId + "/members/github:1", { method: "DELETE", session: ownerSession }))
        .status,
    ).toBe(400);
    expect(
      (await requestJson("/v1/cards/" + cardId + "/members/not-a-user", { method: "DELETE", session: ownerSession }))
        .status,
    ).toBe(400);

    expect((await requestJson("/v1/cards", { method: "DELETE", session: ownerSession })).status).toBe(405);
    expect((await requestJson("/v1/cards/" + cardId + "/nope", { method: "POST", session: ownerSession })).status).toBe(
      404,
    );

    expect(existsSync(join(home, "board.db"))).toBe(true);
    expect(existsSync(join(home, "kitchen.db"))).toBe(false);

    await board.close();
    board = await startBoardServer({ port: 0, host: "127.0.0.1", webRoot: home });
    expect((await requestJson("/v1/cards")).status).toBe(503);
  });
});
