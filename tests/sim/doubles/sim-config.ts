import type { Config, KitchenConfig, RepoConfig } from "../../../src/application/ports.ts";

export class SimConfig implements Config {
  readonly repo: RepoConfig;
  private readonly config: KitchenConfig;
  constructor(repo: RepoConfig) {
    this.repo = repo;
    this.config = { repos: [repo], roundMinutes: 15 };
  }
  load(): Promise<KitchenConfig> { return Promise.resolve(this.config); }
  setBase(branch: string, base: string): void { this.repo.bases[branch] = base; }
  removeBase(branch: string): void { delete this.repo.bases[branch]; }
}
