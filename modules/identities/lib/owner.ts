import { isUserId } from "./contract.ts";
import type { UserId } from "./contract.ts";

const BARE_NUMERIC = /^[1-9][0-9]*$/;

export function normalizeOwnerId(raw: string | undefined): UserId | null {
  if (raw === undefined) return null;
  const text = raw.trim();
  if (BARE_NUMERIC.test(text)) {
    const prefixed = "github:" + text;
    return isUserId(prefixed) ? prefixed : null;
  }
  return isUserId(text) ? text : null;
}

export function isOwner(user: UserId, owner: UserId | null): boolean {
  return owner !== null && user === owner;
}
