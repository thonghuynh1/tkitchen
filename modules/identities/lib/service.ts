import { timingSafeEqual } from "node:crypto";
import type { Clock, Ids } from "../../platform/index.ts";
import { isSessionId, userIdFromGithub } from "./contract.ts";
import type { GitHubOAuthPort, IdentityStore, IdentityUser, SessionId, UserId } from "./contract.ts";
import { isOwner } from "./owner.ts";
import { safeReturnTo } from "./return-to.ts";

const MS_PER_SECOND = 1000;
const MS_PER_DAY = 86_400_000;
const SESSION_TTL_DAYS = 30;
export const SESSION_TTL_MS = SESSION_TTL_DAYS * MS_PER_DAY;

export interface IdentityServiceDeps {
  store: IdentityStore;
  oauth: GitHubOAuthPort;
  clock: Clock;
  ids: Ids;
  ownerId: UserId | null;
  sessionTtlMs?: number;
}

export interface SignInStart {
  location: string;
  state: string;
  returnTo: string;
}

export type SignInOutcome =
  | { ok: true; sessionId: SessionId; maxAgeSeconds: number; user: IdentityUser }
  | { ok: false; reason: "state-mismatch" | "exchange-failed" };

export interface Viewer {
  user: IdentityUser;
  isOwner: boolean;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class IdentityService {
  private readonly store: IdentityStore;
  private readonly oauth: GitHubOAuthPort;
  private readonly clock: Clock;
  private readonly ids: Ids;
  private readonly ownerId: UserId | null;
  private readonly sessionTtlMs: number;

  constructor(deps: IdentityServiceDeps) {
    this.store = deps.store;
    this.oauth = deps.oauth;
    this.clock = deps.clock;
    this.ids = deps.ids;
    this.ownerId = deps.ownerId;
    this.sessionTtlMs = deps.sessionTtlMs ?? SESSION_TTL_MS;
  }

  private token(): string {
    return (this.ids.next() + this.ids.next()).replaceAll("-", "");
  }

  beginSignIn(input: { returnTo: string | null; redirectUri: string }): SignInStart {
    const state = this.token();
    return {
      state,
      returnTo: safeReturnTo(input.returnTo),
      location: this.oauth.authorizeUrl({ state, redirectUri: input.redirectUri }),
    };
  }

  async completeSignIn(input: {
    code: string;
    state: string;
    expectedState: string | undefined;
    redirectUri: string;
  }): Promise<SignInOutcome> {
    if (input.expectedState === undefined || input.state === "" || !sameText(input.state, input.expectedState)) {
      return { ok: false, reason: "state-mismatch" };
    }
    let profile;
    try {
      profile = await this.oauth.exchangeCode({ code: input.code, redirectUri: input.redirectUri });
    } catch {
      return { ok: false, reason: "exchange-failed" };
    }
    const nowMs = this.clock.now().getTime();
    const user: IdentityUser = {
      id: userIdFromGithub(profile.githubId),
      githubId: profile.githubId,
      login: profile.login,
    };
    this.store.upsertUser(user, nowMs);
    const sessionId = this.token();
    if (!isSessionId(sessionId)) throw new Error("session token is not well formed");
    this.store.createSession({
      id: sessionId,
      userId: user.id,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + this.sessionTtlMs,
    });
    return { ok: true, sessionId, maxAgeSeconds: Math.floor(this.sessionTtlMs / MS_PER_SECOND), user };
  }

  viewer(sessionToken: string | undefined): Viewer | null {
    if (sessionToken === undefined || !isSessionId(sessionToken)) return null;
    const session = this.store.getSession(sessionToken);
    if (session === null) return null;
    if (session.expiresAtMs <= this.clock.now().getTime()) {
      this.store.deleteSession(session.id);
      return null;
    }
    const user = this.store.getUser(session.userId);
    if (user === null) return null;
    return { user, isOwner: isOwner(user.id, this.ownerId) };
  }

  signOut(sessionToken: string | undefined): void {
    if (sessionToken === undefined || !isSessionId(sessionToken)) return;
    this.store.deleteSession(sessionToken);
  }
}
