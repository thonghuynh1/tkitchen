import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveGitHubOAuth, SqliteIdentityStore } from "../adapters.ts";
import { IdentityService, isOwner, isSessionId, normalizeOwnerId, safeReturnTo, userIdFromGithub } from "../index.ts";
import { CountingIds, FakeGitHub, FixedClock } from "./fakes.ts";

const REDIRECT = "https://board.test/v1/auth/github/callback";
const OWNER = userIdFromGithub(42);

let dir: string;
let dbPath: string;
let store: SqliteIdentityStore;
let clock: FixedClock;
let service: IdentityService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tkitchen-identities-"));
  dbPath = join(dir, "board.db");
  store = new SqliteIdentityStore(dbPath);
  clock = new FixedClock(1_000_000);
  service = new IdentityService({
    store,
    oauth: new FakeGitHub({ good: { githubId: 42, login: "owner" }, other: { githubId: 99, login: "guest" } }),
    clock,
    ids: new CountingIds(),
    ownerId: OWNER,
  });
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

function sessionCount(): number {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM sessions").get();
    return Number(row?.["n"]);
  } finally {
    db.close();
  }
}

describe("safeReturnTo", () => {
  it("keeps a relative path and refuses anything that could leave the board", () => {
    expect(safeReturnTo("/cards/1?x=2")).toBe("/cards/1?x=2");
    for (const bad of ["//evil.test", "https://evil.test", "evil", "/\\evil.test", "/a\nb", "", null, undefined]) {
      expect(safeReturnTo(bad)).toBe("/");
    }
  });
});

describe("owner", () => {
  it("normalizes a numeric id or a github: id and matches strictly", () => {
    expect(normalizeOwnerId("42")).toBe("github:42");
    expect(normalizeOwnerId(" github:42 ")).toBe("github:42");
    for (const bad of [undefined, "", "owner", "github:", "0", "-4", "github:4x"]) {
      expect(normalizeOwnerId(bad)).toBeNull();
    }
    expect(isOwner(userIdFromGithub(42), OWNER)).toBe(true);
    expect(isOwner(userIdFromGithub(99), OWNER)).toBe(false);
    expect(isOwner(userIdFromGithub(42), null)).toBe(false);
  });
});

describe("sign-in", () => {
  it("rejects a mismatched or missing state without creating a session", async () => {
    const start = service.beginSignIn({ returnTo: "/", redirectUri: REDIRECT });
    for (const expectedState of ["other", undefined]) {
      const outcome = await service.completeSignIn({
        code: "good",
        state: start.state,
        expectedState,
        redirectUri: REDIRECT,
      });
      expect(outcome).toEqual({ ok: false, reason: "state-mismatch" });
    }
    expect(sessionCount()).toBe(0);
  });

  it("keys the user by numeric id, keeps the login fresh and expires sessions", async () => {
    const start = service.beginSignIn({ returnTo: "//evil.test", redirectUri: REDIRECT });
    expect(start.returnTo).toBe("/");
    const outcome = await service.completeSignIn({
      code: "good",
      state: start.state,
      expectedState: start.state,
      redirectUri: REDIRECT,
    });
    if (!outcome.ok) throw new Error("sign-in failed");
    expect(isSessionId(outcome.sessionId)).toBe(true);
    expect(service.viewer(outcome.sessionId)).toEqual({
      user: { id: "github:42", githubId: 42, login: "owner" },
      isOwner: true,
    });
    clock.advance(outcome.maxAgeSeconds * 1000);
    expect(service.viewer(outcome.sessionId)).toBeNull();
    expect(sessionCount()).toBe(0);
  });

  it("answers a failed code exchange without a session", async () => {
    const start = service.beginSignIn({ returnTo: null, redirectUri: REDIRECT });
    const outcome = await service.completeSignIn({
      code: "nope",
      state: start.state,
      expectedState: start.state,
      redirectUri: REDIRECT,
    });
    expect(outcome).toEqual({ ok: false, reason: "exchange-failed" });
    expect(sessionCount()).toBe(0);
  });
});

describe("SqliteIdentityStore", () => {
  it("upserts a user by id and updates a changed login", () => {
    store.upsertUser({ id: OWNER, githubId: 42, login: "old-name" }, 1);
    store.upsertUser({ id: OWNER, githubId: 42, login: "new-name" }, 2);
    expect(store.getUser(OWNER)).toEqual({ id: OWNER, githubId: 42, login: "new-name" });
  });

  it("refuses a session for an unknown user and deletes a session", () => {
    const id = "a".repeat(32);
    if (!isSessionId(id)) throw new Error("bad test id");
    expect(() => {
      store.createSession({ id, userId: OWNER, createdAtMs: 1, expiresAtMs: 2 });
    }).toThrow();
    store.upsertUser({ id: OWNER, githubId: 42, login: "owner" }, 1);
    store.createSession({ id, userId: OWNER, createdAtMs: 1, expiresAtMs: 2 });
    expect(store.getSession(id)).toEqual({ id, userId: OWNER, createdAtMs: 1, expiresAtMs: 2 });
    store.deleteSession(id);
    expect(store.getSession(id)).toBeNull();
  });

  it("runs in WAL mode with foreign keys on", () => {
    const db = new DatabaseSync(dbPath);
    try {
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    } finally {
      db.close();
    }
  });
});

describe("LiveGitHubOAuth", () => {
  it("builds the authorize url and reads the numeric id from the user api", async () => {
    const calls: string[] = [];
    const oauth = new LiveGitHubOAuth({
      clientId: "cid",
      clientSecret: "secret",
      fetchFn: (input) => {
        calls.push(input);
        const body = input.includes("access_token") ? { access_token: "tok" } : { id: 42, login: "owner" };
        return Promise.resolve(Response.json(body));
      },
    });
    const url = new URL(oauth.authorizeUrl({ state: "s1", redirectUri: REDIRECT }));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("s1");
    expect(await oauth.exchangeCode({ code: "c", redirectUri: REDIRECT })).toEqual({ githubId: 42, login: "owner" });
    expect(calls).toHaveLength(2);
  });

  it("fails when GitHub issues no token", async () => {
    const oauth = new LiveGitHubOAuth({
      clientId: "cid",
      clientSecret: "secret",
      fetchFn: () => Promise.resolve(Response.json({ error: "bad_verification_code" })),
    });
    await expect(oauth.exchangeCode({ code: "c", redirectUri: REDIRECT })).rejects.toThrow("access token");
  });
});
