export { isSessionId, isUserId, userIdFromGithub } from "./lib/contract.ts";
export type {
  GitHubOAuthPort,
  GitHubProfile,
  IdentityStore,
  IdentityUser,
  SessionId,
  SessionRecord,
  UserId,
} from "./lib/contract.ts";
export { isOwner, normalizeOwnerId } from "./lib/owner.ts";
export { safeReturnTo } from "./lib/return-to.ts";
export { IdentityService, SESSION_TTL_MS } from "./lib/service.ts";
export type { IdentityServiceDeps, SignInOutcome, SignInStart, Viewer } from "./lib/service.ts";
