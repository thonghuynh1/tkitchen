import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import type { ExportReadPort, ExportRow } from "../../application/export.ts";
import type { Trigger } from "../../domain/trigger/trigger.ts";
import { textCol, textOrNull, intCol } from "./store.ts";

type Row = Record<string, unknown>;
function rows(v: unknown): Row[] { return Array.isArray(v) ? v.filter((r): r is Row => typeof r === "object" && r !== null) : []; }
function parseStringArray(text: string): string[] {
  const v = JSON.parse(text) as unknown;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error("expected a JSON string array");
  return v.filter((x): x is string => typeof x === "string");
}
function readTrigger(r: Row): Trigger {
  const metaRaw = JSON.parse(textCol(r, "meta")) as unknown;
  if (typeof metaRaw !== "object" || metaRaw === null || Array.isArray(metaRaw)) throw new Error("bad event meta");
  const meta: Record<string, unknown> = {};
  Object.assign(meta, metaRaw);
  const base = meta["base"]; const oldHead = meta["oldHead"]; const newHead = meta["newHead"];
  if (typeof base !== "string" || typeof oldHead !== "string" || typeof newHead !== "string") throw new Error("bad event meta");
  return {
    id: textCol(r, "id"), source: textCol(r, "source"),
    threads: parseStringArray(textCol(r, "threads")),
    actor: textCol(r, "actor"), human: intCol(r, "human") !== 0,
    addressed: textOrNull(r, "addressed"), at: textCol(r, "at"),
    text: textOrNull(r, "text"), channel: textOrNull(r, "channel"), url: textOrNull(r, "url"),
    machine: textCol(r, "machine"),
    meta: { base, oldHead, newHead },
  };
}

export class ReadOnlyExportStore implements ExportReadPort {
  private readonly db: DatabaseSync | null;
  constructor(dbPath: string) {
    this.db = existsSync(dbPath) ? new DatabaseSync(dbPath, { readOnly: true }) : null;
  }
  close(): void { this.db?.close(); }
  eventIdAtSeq(seq: number): string | undefined {
    if (this.db === null) return undefined;
    const found = rows(this.db.prepare("SELECT id FROM event WHERE seq = ?").all(seq));
    return found.length > 0 ? textCol(found[0] ?? {}, "id") : undefined;
  }
  rowsAfter(seq: number): ExportRow[] {
    if (this.db === null) return [];
    return rows(this.db.prepare("SELECT seq, id, source, threads, actor, human, addressed, at, text, channel, url, machine, meta FROM event WHERE seq > ? ORDER BY seq").all(seq))
      .map((r) => ({ seq: intCol(r, "seq"), trigger: readTrigger(r) }));
  }
}
