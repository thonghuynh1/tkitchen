import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isUserId } from "../../../identities/index.ts";
import type { UserId } from "../../../identities/index.ts";
import { isCardColumn, isCardId, isInviteToken } from "../contract.ts";
import type { Card, CardColumn, CardId, CardInvite, CardStore, CardSummary, InviteToken } from "../contract.ts";

const BUSY_TIMEOUT_MS = 5000;

const DDL = [
  "CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, title TEXT NOT NULL, column_name TEXT NOT NULL CHECK (column_name IN ('todo', 'doing', 'done')), owner_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT)",
  "CREATE TABLE IF NOT EXISTS card_members (card_id TEXT NOT NULL REFERENCES cards(id), user_id TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY (card_id, user_id))",
  "CREATE INDEX IF NOT EXISTS card_members_user ON card_members(user_id)",
  "CREATE TABLE IF NOT EXISTS card_invites (token TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), created_at TEXT NOT NULL, revoked_at TEXT)",
  "CREATE INDEX IF NOT EXISTS card_invites_card ON card_invites(card_id)",
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

function cardFromRow(row: Row): Card {
  const rawId = textCol(row, "id");
  const rawColumn = textCol(row, "column_name");
  const rawOwner = textCol(row, "owner_id");
  if (!isCardId(rawId) || !isCardColumn(rawColumn) || !isUserId(rawOwner)) {
    throw new Error("stored card row is malformed");
  }
  return {
    id: rawId,
    title: textCol(row, "title"),
    column: rawColumn,
    ownerId: rawOwner,
    createdAt: textCol(row, "created_at"),
    updatedAt: textCol(row, "updated_at"),
    archivedAt: nullableTextCol(row, "archived_at"),
  };
}

function userIdsFromRows(rows: Row[]): UserId[] {
  const userIds: UserId[] = [];
  for (const row of rows) {
    const rawUser = textCol(row, "user_id");
    if (!isUserId(rawUser)) throw new Error("stored member user_id is malformed");
    userIds.push(rawUser);
  }
  return userIds;
}

export class SqliteCardStore implements CardStore {
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
    this.db.exec("BEGIN");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private summaryFor(cardId: CardId): CardSummary | null {
    const card = this.getCard(cardId);
    if (card === null || card.archivedAt !== null) return null;
    return {
      id: card.id,
      title: card.title,
      column: card.column,
      ownerId: card.ownerId,
      memberIds: this.listMemberIds(card.id),
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  }

  createCard(card: Card): void {
    this.runInTx(() => {
      this.db
        .prepare(
          "INSERT INTO cards (id, title, column_name, owner_id, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(card.id, card.title, card.column, card.ownerId, card.createdAt, card.updatedAt, card.archivedAt);
      this.db
        .prepare("INSERT INTO card_members (card_id, user_id, joined_at) VALUES (?, ?, ?)")
        .run(card.id, card.ownerId, card.createdAt);
    });
  }

  getCard(cardId: CardId): Card | null {
    const row = this.db
      .prepare("SELECT id, title, column_name, owner_id, created_at, updated_at, archived_at FROM cards WHERE id = ?")
      .get(cardId);
    if (row === undefined) return null;
    return cardFromRow(row);
  }

  listActiveCardsForUser(userId: UserId): CardSummary[] {
    const rows = this.db
      .prepare(
        "SELECT c.id, c.title, c.column_name, c.owner_id, c.created_at, c.updated_at, c.archived_at FROM cards c WHERE c.archived_at IS NULL AND (c.owner_id = ? OR EXISTS (SELECT 1 FROM card_members m WHERE m.card_id = c.id AND m.user_id = ?)) ORDER BY c.created_at ASC, c.id ASC",
      )
      .all(userId, userId);
    const summaries: CardSummary[] = [];
    for (const row of rows) {
      const card = cardFromRow(row);
      summaries.push({
        id: card.id,
        title: card.title,
        column: card.column,
        ownerId: card.ownerId,
        memberIds: this.listMemberIds(card.id),
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      });
    }
    return summaries;
  }

  updateCardColumn(cardId: CardId, column: CardColumn, updatedAt: string): CardSummary | null {
    const updated = this.db
      .prepare("UPDATE cards SET column_name = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL")
      .run(column, updatedAt, cardId);
    if (Number(updated.changes) === 0) return null;
    return this.summaryFor(cardId);
  }

  isMember(cardId: CardId, userId: UserId): boolean {
    const row = this.db
      .prepare("SELECT 1 AS ok FROM card_members WHERE card_id = ? AND user_id = ?")
      .get(cardId, userId);
    return row !== undefined;
  }

  listMemberIds(cardId: CardId): UserId[] {
    const rows = this.db
      .prepare("SELECT user_id FROM card_members WHERE card_id = ? ORDER BY joined_at ASC, user_id ASC")
      .all(cardId);
    return userIdsFromRows(rows);
  }

  getActiveInvite(cardId: CardId): CardInvite | null {
    const row = this.db
      .prepare(
        "SELECT token, card_id, created_at, revoked_at FROM card_invites WHERE card_id = ? AND revoked_at IS NULL LIMIT 1",
      )
      .get(cardId);
    if (row === undefined) return null;
    const rawToken = textCol(row, "token");
    const rawCardId = textCol(row, "card_id");
    if (!isInviteToken(rawToken) || !isCardId(rawCardId)) {
      throw new Error("stored invite row is malformed");
    }
    return {
      token: rawToken,
      cardId: rawCardId,
      createdAt: textCol(row, "created_at"),
      revokedAt: nullableTextCol(row, "revoked_at"),
    };
  }

  createInvite(invite: CardInvite): void {
    this.db
      .prepare("INSERT INTO card_invites (token, card_id, created_at, revoked_at) VALUES (?, ?, ?, ?)")
      .run(invite.token, invite.cardId, invite.createdAt, invite.revokedAt);
  }

  redeemInvite(token: InviteToken, userId: UserId, joinedAt: string): CardSummary | null {
    return this.runInTx(() => {
      const row = this.db
        .prepare(
          "SELECT i.card_id FROM card_invites i JOIN cards c ON c.id = i.card_id WHERE i.token = ? AND i.revoked_at IS NULL AND c.archived_at IS NULL",
        )
        .get(token);
      if (row === undefined) return null;
      const rawCardId = textCol(row, "card_id");
      if (!isCardId(rawCardId)) throw new Error("stored invite card_id is malformed");
      this.db
        .prepare("INSERT OR IGNORE INTO card_members (card_id, user_id, joined_at) VALUES (?, ?, ?)")
        .run(rawCardId, userId, joinedAt);
      return this.summaryFor(rawCardId);
    });
  }

  removeMemberAndRevokeInvite(cardId: CardId, userId: UserId, revokedAt: string): { removed: boolean } {
    return this.runInTx(() => {
      const deleted = this.db.prepare("DELETE FROM card_members WHERE card_id = ? AND user_id = ?").run(cardId, userId);
      this.db
        .prepare("UPDATE card_invites SET revoked_at = ? WHERE card_id = ? AND revoked_at IS NULL")
        .run(revokedAt, cardId);
      return { removed: Number(deleted.changes) > 0 };
    });
  }

  closeSharing(cardId: CardId, revokedAt: string): { removedUserIds: UserId[] } {
    return this.runInTx(() => {
      const row = this.db.prepare("SELECT owner_id FROM cards WHERE id = ?").get(cardId);
      if (row === undefined) return { removedUserIds: [] };
      const ownerId = textCol(row, "owner_id");
      const memberRows = this.db
        .prepare(
          "SELECT user_id FROM card_members WHERE card_id = ? AND user_id != ? ORDER BY joined_at ASC, user_id ASC",
        )
        .all(cardId, ownerId);
      const removedUserIds = userIdsFromRows(memberRows);
      this.db.prepare("DELETE FROM card_members WHERE card_id = ? AND user_id != ?").run(cardId, ownerId);
      this.db
        .prepare("UPDATE card_invites SET revoked_at = ? WHERE card_id = ? AND revoked_at IS NULL")
        .run(revokedAt, cardId);
      return { removedUserIds };
    });
  }

  archiveCard(cardId: CardId, archivedAt: string): { archived: boolean; removedUserIds: UserId[] } {
    return this.runInTx(() => {
      const row = this.db.prepare("SELECT owner_id FROM cards WHERE id = ? AND archived_at IS NULL").get(cardId);
      if (row === undefined) return { archived: false, removedUserIds: [] };
      const ownerId = textCol(row, "owner_id");
      const memberRows = this.db
        .prepare(
          "SELECT user_id FROM card_members WHERE card_id = ? AND user_id != ? ORDER BY joined_at ASC, user_id ASC",
        )
        .all(cardId, ownerId);
      const removedUserIds = userIdsFromRows(memberRows);
      this.db
        .prepare("UPDATE cards SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL")
        .run(archivedAt, archivedAt, cardId);
      this.db
        .prepare("UPDATE card_invites SET revoked_at = ? WHERE card_id = ? AND revoked_at IS NULL")
        .run(archivedAt, cardId);
      this.db.prepare("DELETE FROM card_members WHERE card_id = ? AND user_id != ?").run(cardId, ownerId);
      return { archived: true, removedUserIds };
    });
  }
}
