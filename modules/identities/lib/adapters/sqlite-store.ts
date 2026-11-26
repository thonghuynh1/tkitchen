import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isSessionId, isUserId } from "../contract.ts";
import type { IdentityStore, IdentityUser, SessionId, SessionRecord, UserId } from "../contract.ts";

const DDL = [
  "CREATE TABLE users (id TEXT PRIMARY KEY, github_id INTEGER NOT NULL UNIQUE, login TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
  "CREATE INDEX sessions_user ON sessions(user_id)",
];

type Row = Record<string, unknown>;

function textCol(row: Row, name: string): string {
  const v = row[name];
  if (typeof v !== "string") throw new Error("column " + name + " is not text");
  return v;
}

function intCol(row: Row, name: string): number {
  const v = row[name];
  if (typeof v !== "number") throw new Error("column " + name + " is not a number");
  return v;
}

export class SqliteIdentityStore implements IdentityStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    const version = intCol(this.db.prepare("PRAGMA user_version").get() ?? {}, "user_version");
    if (version === 0) {
      this.db.exec("BEGIN");
      try {
        for (const stmt of DDL) this.db.exec(stmt);
        this.db.exec("PRAGMA user_version = 1");
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
  }

  close(): void {
    this.db.close();
  }

  upsertUser(user: IdentityUser, atMs: number): void {
    this.db
      .prepare(
        "INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET login = excluded.login, updated_at = excluded.updated_at",
      )
      .run(user.id, user.githubId, user.login, atMs, atMs);
  }

  getUser(id: UserId): IdentityUser | null {
    const row = this.db.prepare("SELECT id, github_id, login FROM users WHERE id = ?").get(id);
    if (row === undefined) return null;
    const stored = textCol(row, "id");
    if (!isUserId(stored)) throw new Error("stored user id is not a UserId: " + stored);
    return { id: stored, githubId: intCol(row, "github_id"), login: textCol(row, "login") };
  }

  createSession(session: SessionRecord): void {
    this.db
      .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(session.id, session.userId, session.createdAtMs, session.expiresAtMs);
  }

  getSession(id: SessionId): SessionRecord | null {
    const row = this.db.prepare("SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ?").get(id);
    if (row === undefined) return null;
    const storedId = textCol(row, "id");
    const storedUser = textCol(row, "user_id");
    if (!isSessionId(storedId) || !isUserId(storedUser)) throw new Error("stored session is malformed");
    return {
      id: storedId,
      userId: storedUser,
      createdAtMs: intCol(row, "created_at"),
      expiresAtMs: intCol(row, "expires_at"),
    };
  }

  deleteSession(id: SessionId): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }
}
