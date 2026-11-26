import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startBoardServer } from "../adapters.ts";
import type { BoardServer } from "../index.ts";
import { SqliteIdentityStore } from "../../identities/adapters.ts";
import { IdentityService, userIdFromGithub } from "../../identities/index.ts";
import type { GitHubOAuthPort, GitHubProfile } from "../../identities/index.ts";

const PUBLIC_URL = "https://board.example.test";
const CALLBACK = PUBLIC_URL + "/v1/auth/github/callback";

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

const fixedClock = { now: (): Date => new Date(1_000_000) };

let home: string;
let store: SqliteIdentityStore;
let board: BoardServer;

async function start(publicUrl: string | undefined): Promise<void> {
  await writeFile(join(home, "index.html"), "<h1>board page</h1>\n");
  store = new SqliteIdentityStore(join(home, "board.db"));
  const identities = new IdentityService({
    store,
    oauth: new FakeGitHub({ owner: { githubId: 42, login: "owner" }, guest: { githubId: 99, login: "guest" } }),
    clock: fixedClock,
    ids: new CountingIds(),
    ownerId: userIdFromGithub(42),
  });
  board = await startBoardServer({ port: 0, host: "127.0.0.1", webRoot: home, publicUrl, identities });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "tkitchen-board-auth-"));
});

afterEach(async () => {
  await board.close();
  store.close();
  await rm(home, { recursive: true, force: true });
});

function cookiesOf(res: Response): string[] {
  return res.headers.getSetCookie();
}

function cookieValue(setCookies: string[], name: string): string {
  const found = setCookies.find((c) => c.startsWith(name + "="));
  if (found === undefined) throw new Error("no cookie " + name);
  return found.slice(name.length + 1).split(";")[0] ?? "";
}

function jar(setCookies: string[], names: string[]): string {
  return names.map((n) => n + "=" + cookieValue(setCookies, n)).join("; ");
}

async function begin(returnTo: string): Promise<{ res: Response; state: string; cookie: string }> {
  const res = await fetch(board.url + "/v1/auth/github?returnTo=" + encodeURIComponent(returnTo), {
    redirect: "manual",
  });
  const location = new URL(res.headers.get("location") ?? "");
  return {
    res,
    state: location.searchParams.get("state") ?? "",
    cookie: jar(cookiesOf(res), ["tkitchen_oauth_state", "tkitchen_oauth_return"]),
  };
}

async function signIn(code: string, returnTo = "/"): Promise<{ res: Response; session: string }> {
  const flow = await begin(returnTo);
  const res = await fetch(board.url + "/v1/auth/github/callback?code=" + code + "&state=" + flow.state, {
    redirect: "manual",
    headers: { cookie: flow.cookie },
  });
  const set = cookiesOf(res);
  const session = set.some((c) => c.startsWith("tkitchen_session=") && !c.includes("Max-Age=0"))
    ? "tkitchen_session=" + cookieValue(set, "tkitchen_session")
    : "";
  return { res, session };
}

function sessionCount(): number {
  const db = new DatabaseSync(join(home, "board.db"));
  try {
    return Number(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.["n"]);
  } finally {
    db.close();
  }
}

describe("board auth", () => {
  it("completes OAuth callback, sets Secure cookie for https publicUrl, and distinguishes owner from non-owner", async () => {
    await start(PUBLIC_URL);
    const flow = await begin("/cards/7");
    expect(flow.res.status).toBe(302);
    const authorize = new URL(flow.res.headers.get("location") ?? "");
    expect(authorize.origin).toBe("https://github.test");
    expect(authorize.searchParams.get("redirect_uri")).toBe(CALLBACK);
    const stateCookie = cookiesOf(flow.res).find((c) => c.startsWith("tkitchen_oauth_state=")) ?? "";
    expect(stateCookie).toContain("HttpOnly");
    expect(stateCookie).toContain("SameSite=Lax");
    expect(stateCookie).toContain("Secure");

    const owner = await signIn("owner", "/cards/7");
    expect(owner.res.status).toBe(302);
    expect(owner.res.headers.get("location")).toBe("/cards/7");
    const sessionCookie = cookiesOf(owner.res).find((c) => c.startsWith("tkitchen_session=")) ?? "";
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(sessionCookie).toContain("Secure");
    const me = await fetch(board.url + "/v1/me", { headers: { cookie: owner.session } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ ok: true, user: { id: "github:42", login: "owner", isOwner: true } });

    const guest = await signIn("guest");
    const guestMe = await fetch(board.url + "/v1/me", { headers: { cookie: guest.session } });
    expect(await guestMe.json()).toEqual({ ok: true, user: { id: "github:99", login: "guest", isOwner: false } });
  });

  it("leaves Secure off when publicUrl is http, and defaults publicUrl to the bind url", async () => {
    await start(undefined);
    expect(board.publicUrl).toBe(board.url);
    const flow = await begin("/");
    const authorize = new URL(flow.res.headers.get("location") ?? "");
    expect(authorize.searchParams.get("redirect_uri")).toBe(board.url + "/v1/auth/github/callback");
    expect(cookiesOf(flow.res).some((c) => c.includes("Secure"))).toBe(false);
  });

  it("rejects bad OAuth state without creating a session and sanitizes returnTo", async () => {
    await start(PUBLIC_URL);
    const flow = await begin("//evil.test");
    const bad = await fetch(board.url + "/v1/auth/github/callback?code=owner&state=forged", {
      redirect: "manual",
      headers: { cookie: flow.cookie },
    });
    expect(bad.status).toBe(400);
    const noCookie = await fetch(board.url + "/v1/auth/github/callback?code=owner&state=" + flow.state, {
      redirect: "manual",
    });
    expect(noCookie.status).toBe(400);
    expect(sessionCount()).toBe(0);
    const ok = await signIn("owner", "//evil.test");
    expect(ok.res.headers.get("location")).toBe("/");
    expect(sessionCount()).toBe(1);
  });

  it("logout invalidates session and never touches kitchen.db", async () => {
    await start(PUBLIC_URL);
    const { session } = await signIn("owner");
    const out = await fetch(board.url + "/v1/auth/logout", { method: "POST", headers: { cookie: session } });
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: true });
    expect(cookiesOf(out).some((c) => c.startsWith("tkitchen_session=;") && c.includes("Max-Age=0"))).toBe(true);
    const me = await fetch(board.url + "/v1/me", { headers: { cookie: session } });
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(existsSync(join(home, "board.db"))).toBe(true);
    expect(existsSync(join(home, "kitchen.db"))).toBe(false);
  });

  it("answers 401 with no cookie, 405 on the wrong method, and 503 when sign-in is not configured", async () => {
    await start(PUBLIC_URL);
    expect((await fetch(board.url + "/v1/me")).status).toBe(401);
    expect((await fetch(board.url + "/v1/auth/logout")).status).toBe(405);
    expect((await fetch(board.url + "/v1/me", { method: "POST" })).status).toBe(405);
    expect((await fetch(board.url + "/v1/auth/nope")).status).toBe(404);
    expect((await fetch(board.url + "/v1/health")).status).toBe(200);
    await board.close();
    board = await startBoardServer({ port: 0, host: "127.0.0.1", webRoot: home });
    expect((await fetch(board.url + "/v1/me")).status).toBe(503);
    expect((await fetch(board.url + "/v1/health")).status).toBe(200);
  });
});
