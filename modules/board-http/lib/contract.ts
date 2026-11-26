import type { IdentityService } from "../../identities/index.ts";

export interface BoardServerOptions {
  port: number;
  host: string;
  webRoot: string;
  publicUrl?: string | undefined;
  identities?: IdentityService | undefined;
}

export interface BoardServer {
  url: string;
  publicUrl: string;
  close(): Promise<void>;
}
