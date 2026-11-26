import type { CardService } from "../../cards/index.ts";
import type { ChatService } from "../../chat/index.ts";
import type { IdentityService } from "../../identities/index.ts";
import type { LiveHub } from "../../live/index.ts";

export interface BoardServerOptions {
  port: number;
  host: string;
  webRoot: string;
  publicUrl?: string | undefined;
  identities?: IdentityService | undefined;
  cards?: CardService | undefined;
  chat?: ChatService | undefined;
  live?: LiveHub | undefined;
}

export interface BoardServer {
  url: string;
  publicUrl: string;
  close(): Promise<void>;
}
