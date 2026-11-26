export type WebUserId = string & { readonly webUserIdBrand: "WebUserId" };

const WEB_USER_ID_PATTERN = /^github:[1-9][0-9]*$/;

export function isWebUserId(value: unknown): value is WebUserId {
  return typeof value === "string" && WEB_USER_ID_PATTERN.test(value);
}

export interface MeUser {
  id: string;
  login: string;
  isOwner: boolean;
}

export type MeResponse = { ok: true; authenticated: true; user: MeUser } | { ok: false; error: "unauthorized" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMeResponse(raw: unknown): MeResponse | null {
  if (!isRecord(raw)) return null;
  if (raw["ok"] === false && raw["error"] === "unauthorized") {
    return { ok: false, error: "unauthorized" };
  }
  if (raw["ok"] !== true || raw["authenticated"] !== true) return null;
  const user = raw["user"];
  if (!isRecord(user)) return null;
  const id = user["id"];
  const login = user["login"];
  const isOwner = user["isOwner"];
  if (typeof id !== "string" || typeof login !== "string" || typeof isOwner !== "boolean") return null;
  return { ok: true, authenticated: true, user: { id, login, isOwner } };
}
