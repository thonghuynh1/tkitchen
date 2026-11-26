export interface BoardServerOptions {
  port: number;
  host: string;
  webRoot: string;
}

export interface BoardServer {
  url: string;
  close(): Promise<void>;
}
