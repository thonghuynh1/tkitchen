import type {
  Card,
  CardColumn,
  CardId,
  CardInvite,
  CardStore,
  CardSummary,
  InviteToken,
} from "../../modules/cards/index.ts";
import type { ChatEntry, ChatEntryId, ChatStore, NewChatEntry } from "../../modules/chat/index.ts";
import type {
  GitHubOAuthPort,
  GitHubProfile,
  IdentityStore,
  IdentityUser,
  SessionId,
  SessionRecord,
  UserId,
} from "../../modules/identities/index.ts";
import type { LiveHandle } from "../../modules/live/index.ts";

export class SimIdentityStore implements IdentityStore {
  private readonly users = new Map<UserId, IdentityUser>();
  private readonly sessions = new Map<SessionId, SessionRecord>();

  upsertUser(user: IdentityUser, _atMs: number): void {
    this.users.set(user.id, { ...user });
  }

  getUser(userId: UserId): IdentityUser | null {
    const found = this.users.get(userId);
    return found === undefined ? null : { ...found };
  }

  createSession(session: SessionRecord): void {
    this.sessions.set(session.id, { ...session });
  }

  getSession(sessionId: SessionId): SessionRecord | null {
    const found = this.sessions.get(sessionId);
    return found === undefined ? null : { ...found };
  }

  deleteSession(sessionId: SessionId): void {
    this.sessions.delete(sessionId);
  }
}

const DEFAULT_OAUTH_PROFILES: ReadonlyMap<string, GitHubProfile> = new Map([
  ["code-owner", { githubId: 1001, login: "owner" }],
  ["code-alice", { githubId: 1002, login: "alice" }],
  ["code-charlie", { githubId: 1003, login: "charlie" }],
  ["code-stranger", { githubId: 1004, login: "stranger" }],
]);

export class SimOAuthPort implements GitHubOAuthPort {
  private readonly profiles: ReadonlyMap<string, GitHubProfile>;

  constructor(profiles: ReadonlyMap<string, GitHubProfile> = DEFAULT_OAUTH_PROFILES) {
    this.profiles = profiles;
  }

  authorizeUrl(input: { state: string; redirectUri: string }): string {
    return (
      "https://github.example.test/login/oauth/authorize?state=" +
      encodeURIComponent(input.state) +
      "&redirect_uri=" +
      encodeURIComponent(input.redirectUri)
    );
  }

  exchangeCode(input: { code: string; redirectUri: string }): Promise<GitHubProfile> {
    const profile = this.profiles.get(input.code);
    if (profile === undefined) return Promise.reject(new Error("unknown oauth code: " + input.code));
    return Promise.resolve({ ...profile });
  }
}

export class SimCardStore implements CardStore {
  private readonly cards = new Map<CardId, Card>();
  private readonly membersByCard = new Map<CardId, Set<UserId>>();
  private readonly invites: CardInvite[] = [];

  private summaryOf(card: Card): CardSummary {
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

  private revokeActiveInvites(cardId: CardId, revokedAt: string): void {
    for (const invite of this.invites) {
      if (invite.cardId === cardId && invite.revokedAt === null) {
        invite.revokedAt = revokedAt;
      }
    }
  }

  createCard(card: Card): void {
    this.cards.set(card.id, { ...card });
    this.membersByCard.set(card.id, new Set<UserId>([card.ownerId]));
  }

  getCard(cardId: CardId): Card | null {
    const found = this.cards.get(cardId);
    return found === undefined ? null : { ...found };
  }

  listActiveCardsForUser(userId: UserId): CardSummary[] {
    const summaries: CardSummary[] = [];
    for (const card of this.cards.values()) {
      if (card.archivedAt !== null) continue;
      if (card.ownerId === userId || this.isMember(card.id, userId)) {
        summaries.push(this.summaryOf(card));
      }
    }
    return summaries;
  }

  updateCardColumn(cardId: CardId, column: CardColumn, updatedAt: string): CardSummary | null {
    const card = this.cards.get(cardId);
    if (card === undefined || card.archivedAt !== null) return null;
    card.column = column;
    card.updatedAt = updatedAt;
    return this.summaryOf(card);
  }

  isMember(cardId: CardId, userId: UserId): boolean {
    return this.membersByCard.get(cardId)?.has(userId) ?? false;
  }

  listMemberIds(cardId: CardId): UserId[] {
    const members = this.membersByCard.get(cardId);
    return members === undefined ? [] : [...members];
  }

  getActiveInvite(cardId: CardId): CardInvite | null {
    for (let i = this.invites.length - 1; i >= 0; i -= 1) {
      const invite = this.invites[i];
      if (invite !== undefined && invite.cardId === cardId && invite.revokedAt === null) {
        return { ...invite };
      }
    }
    return null;
  }

  createInvite(invite: CardInvite): void {
    this.invites.push({ ...invite });
  }

  redeemInvite(token: InviteToken, userId: UserId, _joinedAt: string): CardSummary | null {
    const invite = this.invites.find((item) => item.token === token && item.revokedAt === null);
    if (invite === undefined) return null;
    const card = this.cards.get(invite.cardId);
    if (card === undefined || card.archivedAt !== null) return null;
    let members = this.membersByCard.get(card.id);
    if (members === undefined) {
      members = new Set<UserId>();
      this.membersByCard.set(card.id, members);
    }
    members.add(userId);
    return this.summaryOf(card);
  }

  removeMemberAndRevokeInvite(cardId: CardId, userId: UserId, revokedAt: string): { removed: boolean } {
    const members = this.membersByCard.get(cardId);
    const removed = members !== undefined && members.delete(userId);
    this.revokeActiveInvites(cardId, revokedAt);
    return { removed };
  }

  closeSharing(cardId: CardId, revokedAt: string): { removedUserIds: UserId[] } {
    const card = this.cards.get(cardId);
    const removedUserIds: UserId[] = [];
    if (card !== undefined) {
      const members = this.membersByCard.get(cardId);
      if (members !== undefined) {
        for (const memberId of [...members]) {
          if (memberId !== card.ownerId) {
            members.delete(memberId);
            removedUserIds.push(memberId);
          }
        }
      }
    }
    this.revokeActiveInvites(cardId, revokedAt);
    return { removedUserIds };
  }

  archiveCard(cardId: CardId, archivedAt: string): { archived: boolean; removedUserIds: UserId[] } {
    const card = this.cards.get(cardId);
    if (card === undefined || card.archivedAt !== null) {
      return { archived: false, removedUserIds: [] };
    }
    card.archivedAt = archivedAt;
    card.updatedAt = archivedAt;
    const closed = this.closeSharing(cardId, archivedAt);
    return { archived: true, removedUserIds: closed.removedUserIds };
  }
}

export class SimChatStore implements ChatStore {
  private readonly entriesByCard = new Map<CardId, ChatEntry[]>();
  private readonly seqByCard = new Map<CardId, number>();

  getEntry(cardId: CardId, entryId: ChatEntryId): ChatEntry | null {
    const entries = this.entriesByCard.get(cardId);
    if (entries === undefined) return null;
    const found = entries.find((entry) => entry.id === entryId);
    return found === undefined ? null : { ...found };
  }

  appendEntry(entry: NewChatEntry): ChatEntry {
    const nextSeq = (this.seqByCard.get(entry.cardId) ?? 0) + 1;
    this.seqByCard.set(entry.cardId, nextSeq);
    const stored: ChatEntry = { ...entry, seq: nextSeq };
    let entries = this.entriesByCard.get(entry.cardId);
    if (entries === undefined) {
      entries = [];
      this.entriesByCard.set(entry.cardId, entries);
    }
    entries.push(stored);
    return { ...stored };
  }

  listEntriesAfter(cardId: CardId, afterSeq: number): ChatEntry[] {
    const entries = this.entriesByCard.get(cardId);
    if (entries === undefined) return [];
    return entries
      .filter((entry) => entry.seq > afterSeq)
      .sort((left, right) => left.seq - right.seq)
      .map((entry) => ({ ...entry }));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class SimStreamClient implements LiveHandle {
  open = true;
  readonly receivedSeqs: number[] = [];
  readonly removedCardIds: string[] = [];
  private buffer = "";
  private unregister: (() => void) | null = null;

  get maxReceivedSeq(): number {
    let maxSeq = 0;
    for (const seq of this.receivedSeqs) {
      if (seq > maxSeq) maxSeq = seq;
    }
    return maxSeq;
  }

  attachUnregister(fn: () => void): void {
    this.unregister = fn;
  }

  drop(): void {
    this.open = false;
    const fn = this.unregister;
    this.unregister = null;
    if (fn !== null) fn();
  }

  write(chunk: string): void {
    if (!this.open) throw new Error("stream is closed");
    this.buffer += chunk;
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawFrame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      this.parseFrame(rawFrame);
      boundary = this.buffer.indexOf("\n\n");
    }
  }

  end(): void {
    this.open = false;
    this.unregister = null;
  }

  private parseFrame(rawFrame: string): void {
    let frameKind = "";
    let rawData = "";
    for (const line of rawFrame.split("\n")) {
      if (line.startsWith("event: ")) frameKind = line.slice(7).trim();
      else if (line.startsWith("data: ")) rawData = line.slice(6).trim();
    }
    if (rawData === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    if (frameKind === "message_created") {
      const inner = parsed["message"];
      if (isRecord(inner) && typeof inner["seq"] === "number") {
        this.receivedSeqs.push(inner["seq"]);
      }
      return;
    }
    if (frameKind === "card_removed" && typeof parsed["cardId"] === "string") {
      this.removedCardIds.push(parsed["cardId"]);
    }
  }
}
