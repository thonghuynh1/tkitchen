import type { RepoConfig } from "../../config/index.ts";

export type PullRequest = { number: number; head: string; base: string; url: string; author: string; crossRepository: boolean };
export interface Forge { listOpenPullRequests(repo: RepoConfig): Promise<PullRequest[]>; }
