export interface RepoConfig { name: string; path: string; remote: string; forge: string; bases: Record<string, string>; }
export interface KitchenConfig { repos: RepoConfig[]; roundMinutes: number; }
export interface Config { load(): Promise<KitchenConfig>; }
