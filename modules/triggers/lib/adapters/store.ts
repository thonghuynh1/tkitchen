import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Trigger } from "../trigger.ts";
import type { Disposition } from "../disposition.ts";
import type { BranchState } from "../../../branches/index.ts";
import type { RoundStatus } from "../contract.ts";

type Row = Record<string, unknown>;
function rows(v: unknown): Row[] { return Array.isArray(v) ? v.filter((r): r is Row => typeof r === "object" && r !== null) : []; }
function textCol(row: Row, name: string): string {
  const v = row[name]; if (typeof v !== "string") throw new Error("column " + name + " is not text"); return v;
}
function textOrNull(row: Row, name: string): string | null {
  const v = row[name]; if (v === null || v === undefined) return null; if (typeof v !== "string") throw new Error("column " + name + " is not text"); return v;
}
function intCol(row: Row, name: string): number {
  const v = row[name]; if (typeof v !== "number") throw new Error("column " + name + " is not a number"); return v;
}
function intOrNull(row: Row, name: string): number | null {
  const v = row[name]; if (v === null || v === undefined) return null; if (typeof v !== "number") throw new Error("column " + name + " is not a number"); return v;
}

const DDL = [
  "CREATE TABLE event (id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, source TEXT NOT NULL, threads TEXT NOT NULL, actor TEXT NOT NULL, human INTEGER NOT NULL, addressed TEXT, at TEXT NOT NULL, text TEXT, channel TEXT, url TEXT, machine TEXT NOT NULL, meta TEXT NOT NULL)",
  "CREATE TABLE disposition (event_id TEXT NOT NULL REFERENCES event(id), thread TEXT NOT NULL, consumer TEXT NOT NULL, filtered INTEGER NOT NULL, outcome TEXT NOT NULL, outcome_event_id TEXT, rule_id TEXT NOT NULL, policy_version INTEGER NOT NULL, handbacks TEXT NOT NULL DEFAULT '[]', at TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (event_id, thread, consumer))",
  "CREATE TABLE repo_heads (repo TEXT NOT NULL, branch TEXT NOT NULL, oid TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY (repo, branch))",
  "CREATE TABLE branch_state (repo TEXT NOT NULL, branch TEXT NOT NULL, base TEXT, base_evidence TEXT, head_oid TEXT NOT NULL, base_oid TEXT, behind_by INTEGER, status TEXT NOT NULL CHECK (status IN ('up_to_date','behind','needs_base','ambiguous')), since TEXT NOT NULL, last_event_id TEXT, PRIMARY KEY (repo, branch))",
  "CREATE TABLE round_status (repo TEXT PRIMARY KEY, last_complete_at TEXT, last_error TEXT)",
];

export class KitchenStore {
  private db: DatabaseSync;
  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    const verRows = rows(this.db.prepare("PRAGMA user_version").all());
    const version = verRows.length > 0 ? intCol(verRows[0] ?? {}, "user_version") : 0;
    if (version === 0) {
      this.db.exec("BEGIN");
      try { for (const stmt of DDL) this.db.exec(stmt); this.db.exec("PRAGMA user_version = 1"); this.db.exec("COMMIT"); }
      catch (e) { this.db.exec("ROLLBACK"); throw e; }
    }
  }
  close(): void { this.db.close(); }
  userVersion(): number { const r = rows(this.db.prepare("PRAGMA user_version").all()); return r.length > 0 ? intCol(r[0] ?? {}, "user_version") : 0; }
  tableNames(): string[] { return rows(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).map((r) => textCol(r, "name")); }
  countRows(table: string): number { const r = rows(this.db.prepare("SELECT COUNT(*) AS n FROM " + table).all()); return r.length > 0 ? intCol(r[0] ?? {}, "n") : 0; }

  listRepoHeadRows(): { repo: string; branch: string; oid: string; seenAt: string }[] {
    return rows(this.db.prepare("SELECT * FROM repo_heads ORDER BY repo, branch").all()).map((r) => ({ repo: textCol(r, "repo"), branch: textCol(r, "branch"), oid: textCol(r, "oid"), seenAt: textCol(r, "seen_at") }));
  }
  getRepoHeads(repo: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const r of rows(this.db.prepare("SELECT branch, oid FROM repo_heads WHERE repo = ?").all(repo))) out.set(textCol(r, "branch"), textCol(r, "oid"));
    return out;
  }
  getBranchStates(repo: string): Map<string, BranchState> {
    const out = new Map<string, BranchState>();
    for (const r of rows(this.db.prepare("SELECT * FROM branch_state WHERE repo = ?").all(repo))) {
      const s = readBranchState(r); out.set(s.branch, s);
    }
    return out;
  }
  listBranchStates(): BranchState[] {
    return rows(this.db.prepare("SELECT * FROM branch_state ORDER BY repo, branch").all()).map(readBranchState);
  }
  listRoundStatus(): RoundStatus[] {
    return rows(this.db.prepare("SELECT * FROM round_status ORDER BY repo").all()).map((r) => ({ repo: textCol(r, "repo"), lastCompleteAt: textOrNull(r, "last_complete_at"), lastError: textOrNull(r, "last_error") }));
  }
  listEvents(): Row[] { return rows(this.db.prepare("SELECT * FROM event ORDER BY seq").all()); }
  listTriggers(): Trigger[] {
    return rows(this.db.prepare("SELECT * FROM event ORDER BY seq").all()).map(readTrigger);
  }
  eventIdAtSeq(seq: number): string | undefined {
    const found = rows(this.db.prepare("SELECT id FROM event WHERE seq = ?").all(seq));
    return found.length > 0 ? textCol(found[0] ?? {}, "id") : undefined;
  }
  exportRowsAfter(seq: number): { seq: number; trigger: Trigger }[] {
    return rows(this.db.prepare("SELECT * FROM event WHERE seq > ? ORDER BY seq").all(seq)).map((r) => ({ seq: intCol(r, "seq"), trigger: readTrigger(r) }));
  }
  listDispositions(): Disposition[] {
    return rows(this.db.prepare("SELECT * FROM disposition ORDER BY event_id, thread, consumer").all()).map((r) => ({
      eventId: textCol(r, "event_id"), thread: textCol(r, "thread"), consumer: textCol(r, "consumer"),
      filtered: intCol(r, "filtered") !== 0, outcome: textCol(r, "outcome"),
      outcomeEventId: textOrNull(r, "outcome_event_id"), ruleId: textCol(r, "rule_id"),
      policyVersion: intCol(r, "policy_version"),
      handbacks: parseStringArray(textCol(r, "handbacks")),
      at: textCol(r, "at"), meta: parseDispositionMeta(textCol(r, "meta")),
    }));
  }

  insertEvent(trigger: Trigger): void { this.insertEventRow(trigger); }
  private insertEventRow(trigger: Trigger): void {
    const seqRows = rows(this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM event").all());
    const seq = (seqRows.length > 0 ? intCol(seqRows[0] ?? {}, "m") : 0) + 1;
    this.db.prepare("INSERT OR IGNORE INTO event (id, seq, source, threads, actor, human, addressed, at, text, channel, url, machine, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(trigger.id, seq, trigger.source, JSON.stringify(trigger.threads), trigger.actor, trigger.human ? 1 : 0, trigger.addressed, trigger.at, trigger.text, trigger.channel, trigger.url, trigger.machine, JSON.stringify(trigger.meta));
  }
  insertDisposition(d: Disposition): void {
    this.db.prepare("INSERT OR IGNORE INTO disposition (event_id, thread, consumer, filtered, outcome, outcome_event_id, rule_id, policy_version, handbacks, at, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(d.eventId, d.thread, d.consumer, d.filtered ? 1 : 0, d.outcome, d.outcomeEventId, d.ruleId, d.policyVersion, JSON.stringify(d.handbacks), d.at, JSON.stringify(d.meta));
  }
  applyRound(input: { repo: string; events: Trigger[]; dispositions: Disposition[]; branchStates: BranchState[]; heads: Map<string, string>; at: string; }): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const e of input.events) this.insertEventRow(e);
      for (const d of input.dispositions) this.insertDisposition(d);
      this.db.prepare("DELETE FROM branch_state WHERE repo = ?").run(input.repo);
      const insState = this.db.prepare("INSERT INTO branch_state (repo, branch, base, base_evidence, head_oid, base_oid, behind_by, status, since, last_event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const s of input.branchStates) insState.run(s.repo, s.branch, s.base, s.baseEvidence, s.headOid, s.baseOid, s.behindBy, s.status, s.since, s.lastEventId);
      this.db.prepare("DELETE FROM repo_heads WHERE repo = ?").run(input.repo);
      const insHead = this.db.prepare("INSERT INTO repo_heads (repo, branch, oid, seen_at) VALUES (?, ?, ?, ?)");
      for (const [branch, oid] of input.heads) insHead.run(input.repo, branch, oid, input.at);
      this.db.prepare("INSERT INTO round_status (repo, last_complete_at, last_error) VALUES (?, ?, NULL) ON CONFLICT(repo) DO UPDATE SET last_complete_at = excluded.last_complete_at, last_error = NULL").run(input.repo, input.at);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  recordRoundError(repo: string, message: string): void {
    this.db.prepare("INSERT INTO round_status (repo, last_complete_at, last_error) VALUES (?, NULL, ?) ON CONFLICT(repo) DO UPDATE SET last_error = excluded.last_error").run(repo, message);
  }
}
function readTrigger(r: Row): Trigger {
  return {
    id: textCol(r, "id"), source: textCol(r, "source"),
    threads: parseStringArray(textCol(r, "threads")),
    actor: textCol(r, "actor"), human: intCol(r, "human") !== 0,
    addressed: textOrNull(r, "addressed"), at: textCol(r, "at"),
    text: textOrNull(r, "text"), channel: textOrNull(r, "channel"), url: textOrNull(r, "url"),
    machine: textCol(r, "machine"),
    meta: parseTriggerMeta(textCol(r, "meta")),
  };
}
function parseJson(text: string): unknown { return JSON.parse(text) as unknown; }
function parseStringArray(text: string): string[] {
  const v = parseJson(text);
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error("expected a JSON string array");
  return v.filter((x): x is string => typeof x === "string");
}
function parseRecord(text: string): Record<string, unknown> {
  const v = parseJson(text);
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("expected a JSON object");
  const out: Record<string, unknown> = {};
  Object.assign(out, v);
  return out;
}
function parseTriggerMeta(text: string): Trigger["meta"] {
  const v = parseRecord(text);
  const base = v["base"]; const oldHead = v["oldHead"]; const newHead = v["newHead"];
  if (typeof base !== "string" || typeof oldHead !== "string" || typeof newHead !== "string") throw new Error("bad event meta");
  return { base, oldHead, newHead };
}
function parseDispositionMeta(text: string): Disposition["meta"] {
  const v = parseRecord(text);
  const behindBy = v["behindBy"];
  if (typeof behindBy !== "number") throw new Error("bad disposition meta");
  return { behindBy };
}
function readBranchState(r: Row): BranchState {
  const status = textCol(r, "status");
  if (status !== "up_to_date" && status !== "behind" && status !== "needs_base" && status !== "ambiguous") throw new Error("bad branch_state.status: " + status);
  return { repo: textCol(r, "repo"), branch: textCol(r, "branch"), base: textOrNull(r, "base"), baseEvidence: textOrNull(r, "base_evidence"), headOid: textCol(r, "head_oid"), baseOid: textOrNull(r, "base_oid"), behindBy: intOrNull(r, "behind_by"), status, since: textCol(r, "since"), lastEventId: textOrNull(r, "last_event_id") };
}
export { textCol, textOrNull, intCol };
