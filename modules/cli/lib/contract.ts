export type Command =
  | { kind: "help" }
  | { kind: "serve" }
  | { kind: "board"; port: number; host: string }
  | { kind: "round"; onlyRepo: string | undefined }
  | { kind: "notices"; json: boolean; history: boolean }
  | { kind: "export"; after: string | undefined };

export type ParsedCommand =
  | { ok: true; command: Command }
  | { ok: false; complaint: string | null; showUsage: boolean };
