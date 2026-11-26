import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isCardId } from "../../../cards/index.ts";
import type { CardId } from "../../../cards/index.ts";
import { isUserId } from "../../../identities/index.ts";
import { isChatEntryId } from "../contract.ts";
import type { ChatEntry, ChatEntryId, ChatStore, NewChatEntry } from "../contract.ts";

const BUSY_TIMEOUT_MS = 5000;

const DDL = [
  "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), seq INTEGER NOT NULL, parent_id TEXT REFERENCES messages(id), author_id TEXT NOT NULL, author_login TEXT NOT NULL, text TEXT NOT NULL, mentions_waiter INTEGER NOT NULL CHECK (mentions_waiter IN (0, 1)), created_at TEXT NOT NULL, UNIQUE (card_id, seq))",
  "CREATE INDEX IF NOT EXISTS messages_card_seq ON messages(card_id, seq)",
];

type Row = Record<string, unknown>;

function textCol(row: Row, name: string): string {
  const value = row[name];
  if (typeof value !== "string") throw new Error("column " + name + " is not text");
  return value;
}

function nullableTextCol(row: Row, name: string): string | null {
  const value = row[name];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("column " + name + " is not text or null");
  return value;
}

function intCol(row: Row, name: string): number {
  const value = row[name];
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error("column " + name + " is not integer");
}

function entryFromRow(row: Row): ChatEntry {
  const rawId = textCol(row, "id");
  const rawCardId = textCol(row, "card_id");
  const rawReplyTo = nullableTextCol(row, "parent_id");
  const rawAuthorId = textCol(row, "author_id");
  if (!isChatEntryId(rawId) || !isCardId(rawCardId) || !isUserId(rawAuthorId)) {
    throw new Error("stored chat row is malformed");
  }
  let replyToId: ChatEntryId | null = null;
  if (rawReplyTo !== null) {
    if (!isChatEntryId(rawReplyTo)) throw new Error("stored chat reply id is malformed");
    replyToId = rawReplyTo;
  }
  return {
    id: rawId,
    cardId: rawCardId,
    seq: intCol(row, "seq"),
    replyToId,
    authorId: rawAuthorId,
    authorLogin: textCol(row, "author_login"),
    text: textCol(row, "text"),
    mentionsWaiter: intCol(row, "mentions_waiter") === 1,
    createdAt: textCol(row, "created_at"),
  };
}

export class SqliteChatStore implements ChatStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = " + String(BUSY_TIMEOUT_MS));
    this.runInTx(() => {
      for (const stmt of DDL) this.db.exec(stmt);
    });
  }

  close(): void {
    this.db.close();
  }

  private runInTx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getEntry(cardId: CardId, entryId: ChatEntryId): ChatEntry | null {
    const row = this.db
      .prepare(
        "SELECT id, card_id, seq, parent_id, author_id, author_login, text, mentions_waiter, created_at FROM messages WHERE card_id = ? AND id = ?",
      )
      .get(cardId, entryId);
    if (row === undefined) return null;
    return entryFromRow(row);
  }

  appendEntry(entry: NewChatEntry): ChatEntry {
    return this.runInTx(() => {
      const seqRow = this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM messages WHERE card_id = ?")
        .get(entry.cardId);
      const seq = seqRow === undefined ? 1 : intCol(seqRow, "next_seq");
      this.db
        .prepare(
          "INSERT INTO messages (id, card_id, seq, parent_id, author_id, author_login, text, mentions_waiter, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          entry.id,
          entry.cardId,
          seq,
          entry.replyToId,
          entry.authorId,
          entry.authorLogin,
          entry.text,
          entry.mentionsWaiter ? 1 : 0,
          entry.createdAt,
        );
      return { ...entry, seq };
    });
  }

  listEntriesAfter(cardId: CardId, afterSeq: number): ChatEntry[] {
    const rows = this.db
      .prepare(
        "SELECT id, card_id, seq, parent_id, author_id, author_login, text, mentions_waiter, created_at FROM messages WHERE card_id = ? AND seq > ? ORDER BY seq ASC",
      )
      .all(cardId, afterSeq);
    return rows.map((row) => entryFromRow(row));
  }
}
