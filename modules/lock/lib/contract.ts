export interface Lock {
  acquire(): Promise<"acquired" | "held">;
  release(): Promise<void>;
  holderPid(): Promise<number | null>;
}
