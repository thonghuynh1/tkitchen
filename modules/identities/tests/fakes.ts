import type { Clock, Ids } from "../../platform/index.ts";
import type { GitHubOAuthPort, GitHubProfile } from "../index.ts";

export class FixedClock implements Clock {
  constructor(private current: number) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

export class CountingIds implements Ids {
  private counter = 0;
  next(): string {
    this.counter += 1;
    return "00000000-0000-4000-8000-" + String(this.counter).padStart(12, "0");
  }
}

export class FakeGitHub implements GitHubOAuthPort {
  readonly exchanged: string[] = [];
  constructor(private readonly profiles: Record<string, GitHubProfile>) {}
  authorizeUrl(input: { state: string; redirectUri: string }): string {
    return (
      "https://github.test/authorize?state=" + input.state + "&redirect_uri=" + encodeURIComponent(input.redirectUri)
    );
  }
  exchangeCode(input: { code: string; redirectUri: string }): Promise<GitHubProfile> {
    this.exchanged.push(input.code);
    const profile = this.profiles[input.code];
    return profile === undefined ? Promise.reject(new Error("bad code")) : Promise.resolve(profile);
  }
}
