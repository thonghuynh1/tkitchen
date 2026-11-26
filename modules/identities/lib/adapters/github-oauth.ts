import type { GitHubOAuthPort, GitHubProfile } from "../contract.ts";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const REQUEST_TIMEOUT_MS = 10_000;

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface LiveGitHubOAuthOptions {
  clientId: string;
  clientSecret: string;
  fetchFn?: FetchFn;
}

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? Object.getOwnPropertyDescriptor(body, name)?.value : undefined;
}

export class LiveGitHubOAuth implements GitHubOAuthPort {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchFn: FetchFn;

  constructor(options: LiveGitHubOAuthOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  }

  authorizeUrl(input: { state: string; redirectUri: string }): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
    });
    return AUTHORIZE_URL + "?" + params.toString();
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<GitHubProfile> {
    const tokenResponse = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const tokenBody: unknown = await tokenResponse.json();
    const accessToken = field(tokenBody, "access_token");
    if (!tokenResponse.ok || typeof accessToken !== "string") {
      throw new Error("GitHub did not issue an access token");
    }
    const userResponse = await this.fetchFn(USER_URL, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: "Bearer " + accessToken,
        "user-agent": "tkitchen-board",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const userBody: unknown = await userResponse.json();
    const githubId = field(userBody, "id");
    const login = field(userBody, "login");
    if (!userResponse.ok || typeof githubId !== "number" || !Number.isInteger(githubId) || typeof login !== "string") {
      throw new Error("GitHub did not return a user");
    }
    return { githubId, login };
  }
}
