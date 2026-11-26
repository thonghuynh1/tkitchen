export type UserId = string & { readonly userIdBrand: "UserId" };
export type SessionId = string & { readonly sessionIdBrand: "SessionId" };

const USER_ID_PATTERN = /^github:[1-9][0-9]*$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9]{16,}$/;

export function isUserId(value: string): value is UserId {
  return USER_ID_PATTERN.test(value);
}

export function isSessionId(value: string): value is SessionId {
  return SESSION_ID_PATTERN.test(value);
}

export function userIdFromGithub(numeric: number): UserId {
  const text = "github:" + String(numeric);
  if (!isUserId(text)) throw new RangeError("not a GitHub numeric id: " + String(numeric));
  return text;
}

export interface IdentityUser {
  id: UserId;
  githubId: number;
  login: string;
}

export interface SessionRecord {
  id: SessionId;
  userId: UserId;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface IdentityStore {
  upsertUser(user: IdentityUser, atMs: number): void;
  getUser(id: UserId): IdentityUser | null;
  createSession(session: SessionRecord): void;
  getSession(id: SessionId): SessionRecord | null;
  deleteSession(id: SessionId): void;
}

export interface GitHubProfile {
  githubId: number;
  login: string;
}

export interface GitHubOAuthPort {
  authorizeUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<GitHubProfile>;
}
