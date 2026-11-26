export interface Clock {
  now(): Date;
}
export interface Scheduler {
  sleep(ms: number): Promise<void>;
}
export interface Random {
  next(): number;
}
export interface Ids {
  next(): string;
}
export class PortError extends Error {
  readonly kind: "timeout" | "failed";
  constructor(kind: "timeout" | "failed", message: string) {
    super(message);
    this.name = "PortError";
    this.kind = kind;
  }
}
