/* oxlint-disable tkitchen/no-comments -- export contract limits */
/*
 * Stated limit: a store replaced by one identical up to the cursor is not
 * detected as a reset; harmless because aiNho dedupes by (machine, id).
 */
import type { Trigger } from "../../triggers/index.ts";

export interface ExportRow {
  seq: number;
  trigger: Trigger;
}

export interface ExportReadPort {
  eventIdAtSeq(seq: number): string | undefined;
  rowsAfter(seq: number): ExportRow[];
}

export type ExportLine =
  | { type: "header"; schema: "tkitchen.export/1"; machine: string; reset: boolean }
  | {
      type: "event";
      seq: number;
      id: string;
      source: string;
      threads: string[];
      actor: string;
      human: boolean;
      addressed: string | null;
      at: string;
      text: string | null;
      channel: string | null;
      url: string | null;
      machine: string;
      meta: Trigger["meta"];
    }
  | { type: "end"; cursor: string; events: number };

export class InvalidCursorError extends Error {
  constructor() {
    super("invalid cursor");
    this.name = "InvalidCursorError";
  }
}

interface Cursor {
  s: number;
  id: string | null;
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;
const CURSOR_KEY_COUNT = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeCursor(input: string): Cursor {
  if (!BASE64URL_PATTERN.test(input)) throw new InvalidCursorError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(input, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new InvalidCursorError();
  }
  if (!isRecord(parsed)) throw new InvalidCursorError();
  const keys = Object.keys(parsed);
  if (keys.length !== CURSOR_KEY_COUNT || !("s" in parsed) || !("id" in parsed)) throw new InvalidCursorError();
  const s = parsed["s"];
  const id = parsed["id"];
  if (typeof s !== "number" || !Number.isSafeInteger(s) || s < 0) throw new InvalidCursorError();
  if (!(typeof id === "string" || id === null)) throw new InvalidCursorError();
  if ((s === 0) !== (id === null)) throw new InvalidCursorError();
  return { s, id };
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function exportLines(
  port: ExportReadPort,
  input: { machine: string; after?: string | undefined },
): ExportLine[] {
  let reset = false;
  let afterSeq = 0;
  let prior: Cursor = { s: 0, id: null };
  if (input.after !== undefined) {
    prior = decodeCursor(input.after);
    if (prior.s === 0) {
      afterSeq = 0;
    } else if (port.eventIdAtSeq(prior.s) === prior.id) {
      afterSeq = prior.s;
    } else {
      reset = true;
      afterSeq = 0;
    }
  }
  const rows = port.rowsAfter(afterSeq);
  const lines: ExportLine[] = [{ type: "header", schema: "tkitchen.export/1", machine: input.machine, reset }];
  let last: Cursor = reset ? { s: 0, id: null } : prior;
  for (const row of rows) {
    const t = row.trigger;
    lines.push({
      type: "event",
      seq: row.seq,
      id: t.id,
      source: t.source,
      threads: [...t.threads],
      actor: t.actor,
      human: t.human,
      addressed: t.addressed,
      at: t.at,
      text: t.text,
      channel: t.channel,
      url: t.url,
      machine: t.machine,
      meta: { ...t.meta },
    });
    last = { s: row.seq, id: t.id };
  }
  lines.push({ type: "end", cursor: encodeCursor(last), events: rows.length });
  return lines;
}

export function serializeExportLines(lines: readonly ExportLine[]): string[] {
  return lines.map((line) => JSON.stringify(line));
}
