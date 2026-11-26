import type { IncomingMessage, ServerResponse } from "node:http";
import { safeReturnTo } from "../../../identities/index.ts";
import type { IdentityService, Viewer } from "../../../identities/index.ts";
import type { MeResponse } from "../../../identities/web.ts";
import { clearedCookie, parseCookies, serializeCookie } from "../cookies.ts";

const ME_PATH = "/v1/me";
const AUTH_PREFIX = "/v1/auth/";
const START_PATH = "/v1/auth/github";
const CALLBACK_PATH = "/v1/auth/github/callback";
const LOGOUT_PATH = "/v1/auth/logout";
const SESSION_COOKIE = "tkitchen_session";
const STATE_COOKIE = "tkitchen_oauth_state";
const RETURN_COOKIE = "tkitchen_oauth_return";
const OAUTH_COOKIE_SECONDS = 600;
const STATUS_OK = 200;
const STATUS_FOUND = 302;
const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;
const STATUS_NOT_FOUND = 404;
const STATUS_METHOD_NOT_ALLOWED = 405;
const STATUS_BAD_GATEWAY = 502;
const STATUS_UNAVAILABLE = 503;

export interface AuthContext {
  identities: IdentityService;
  publicUrl: string;
}

export function isAuthPath(pathname: string): boolean {
  return pathname === ME_PATH || pathname.startsWith(AUTH_PREFIX);
}

function sendJson(res: ServerResponse, status: number, body: unknown, cookies: string[] = []): void {
  const headers: Record<string, string | string[]> = { "content-type": "application/json" };
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string, cookies: string[]): void {
  res.writeHead(STATUS_FOUND, { location, "set-cookie": cookies });
  res.end();
}

function isSecure(context: AuthContext): boolean {
  return context.publicUrl.startsWith("https://");
}

function redirectUri(context: AuthContext): string {
  return context.publicUrl + CALLBACK_PATH;
}

function sessionToken(req: IncomingMessage): string | undefined {
  return parseCookies(req.headers.cookie).get(SESSION_COOKIE);
}

export function viewerFromRequest(context: AuthContext, req: IncomingMessage): Viewer | null {
  return context.identities.viewer(sessionToken(req));
}

function startSignIn(context: AuthContext, url: URL, res: ServerResponse): void {
  const start = context.identities.beginSignIn({
    returnTo: url.searchParams.get("returnTo"),
    redirectUri: redirectUri(context),
  });
  const attributes = { maxAgeSeconds: OAUTH_COOKIE_SECONDS, secure: isSecure(context) };
  redirect(res, start.location, [
    serializeCookie(STATE_COOKIE, start.state, attributes),
    serializeCookie(RETURN_COOKIE, encodeURIComponent(start.returnTo), attributes),
  ]);
}

async function finishSignIn(context: AuthContext, req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
  const secure = isSecure(context);
  const cookies = parseCookies(req.headers.cookie);
  const spent = [clearedCookie(STATE_COOKIE, secure), clearedCookie(RETURN_COOKIE, secure)];
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code === null || code === "" || state === null) {
    sendJson(res, STATUS_BAD_REQUEST, { ok: false, error: "missing code or state" }, spent);
    return;
  }
  const outcome = await context.identities.completeSignIn({
    code,
    state,
    expectedState: cookies.get(STATE_COOKIE),
    redirectUri: redirectUri(context),
  });
  if (!outcome.ok) {
    const failed = outcome.reason === "state-mismatch";
    sendJson(
      res,
      failed ? STATUS_BAD_REQUEST : STATUS_BAD_GATEWAY,
      { ok: false, error: failed ? "state mismatch" : "GitHub sign-in failed" },
      spent,
    );
    return;
  }
  const savedReturn = cookies.get(RETURN_COOKIE);
  const returnTo = safeReturnTo(savedReturn === undefined ? null : decodeURIComponent(savedReturn));
  redirect(res, returnTo, [
    ...spent,
    serializeCookie(SESSION_COOKIE, outcome.sessionId, { maxAgeSeconds: outcome.maxAgeSeconds, secure }),
  ]);
}

function logout(context: AuthContext, req: IncomingMessage, res: ServerResponse): void {
  context.identities.signOut(sessionToken(req));
  sendJson(res, STATUS_OK, { ok: true }, [clearedCookie(SESSION_COOKIE, isSecure(context))]);
}

function me(context: AuthContext, req: IncomingMessage, res: ServerResponse): void {
  const viewer = context.identities.viewer(sessionToken(req));
  if (viewer === null) {
    const refused: MeResponse = { ok: false, error: "unauthorized" };
    sendJson(res, STATUS_UNAUTHORIZED, refused);
    return;
  }
  const body: MeResponse = {
    ok: true,
    authenticated: true,
    user: { id: viewer.user.id, login: viewer.user.login, isOwner: viewer.isOwner },
  };
  sendJson(res, STATUS_OK, body);
}

export async function routeAuth(
  context: AuthContext | null,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (context === null) {
    sendJson(res, STATUS_UNAVAILABLE, { ok: false, error: "sign-in is not configured" });
    return;
  }
  const wanted = url.pathname === LOGOUT_PATH ? "POST" : "GET";
  const known = url.pathname === ME_PATH || url.pathname === START_PATH || url.pathname === CALLBACK_PATH;
  if (!known && url.pathname !== LOGOUT_PATH) {
    sendJson(res, STATUS_NOT_FOUND, { ok: false, error: "not found" });
    return;
  }
  if (req.method !== wanted) {
    sendJson(res, STATUS_METHOD_NOT_ALLOWED, { ok: false, error: "method not allowed" });
    return;
  }
  if (url.pathname === ME_PATH) me(context, req, res);
  else if (url.pathname === START_PATH) startSignIn(context, url, res);
  else if (url.pathname === CALLBACK_PATH) await finishSignIn(context, req, url, res);
  else logout(context, req, res);
}
