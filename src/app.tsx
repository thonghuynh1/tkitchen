import { useCallback, useEffect, useRef, useState } from "react";
import { AuthScreen } from "@/components/auth-screen";
import { BoardHeader } from "@/components/board-header";
import { CardChatPanel } from "@/components/card-chat-panel";
import { CardItem } from "@/components/card-item";
import { InviteInvalidScreen } from "@/components/invite-invalid-screen";
import { NewCardDialog } from "@/components/new-card-dialog";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  closeCardSharing,
  createCard,
  createInviteLink,
  deleteCard,
  fetchCards,
  fetchChatEntries,
  fetchMe,
  moveCard,
  postChatEntry,
  postLogout,
  redeemInvite,
  removeCardMember,
} from "@/lib/board-api";
import {
  BOARD_COLUMNS,
  closeCardSharingInList,
  ensureCardMember,
  extractInviteTokenFromPath,
  lastSeqOf,
  mergeChatEntries,
  moveCardInList,
  removeCardFromList,
  removeCardMemberFromList,
  upsertCard,
} from "@/lib/board-state";
import type { AppSession } from "@/lib/board-state";
import { isCardMemberId, isWebCardId, parseWebCard } from "../modules/cards/web";
import type { CardColumn, CardMemberId, WebCard, WebCardId } from "../modules/cards/web";
import { parseWebChatEntry } from "../modules/chat/web";
import type { WebChatEntry, WebChatEntryId } from "../modules/chat/web";
import { LIVE_FRAME_KINDS, parseLiveFrame } from "../modules/live/web";
import type { WebLiveFrame, WebLiveFrameKind } from "../modules/live/web";

function hasDataPayload(domEvt: Event): domEvt is MessageEvent<unknown> {
  return "data" in domEvt;
}

export function App(): React.JSX.Element {
  const [session, setSession] = useState<AppSession>({ kind: "loading" });
  const [cards, setCards] = useState<WebCard[]>([]);
  const [openCardId, setOpenCardId] = useState<WebCardId | null>(null);
  const [entriesByCard, setEntriesByCard] = useState<Record<string, WebChatEntry[]>>({});
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [boardNotice, setBoardNotice] = useState<string | null>(null);
  const [copiedInvites, setCopiedInvites] = useState<Record<string, string>>({});
  const [loginByUserId, setLoginByUserId] = useState<Record<string, string>>({});
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [newCardBusy, setNewCardBusy] = useState(false);
  const [newCardError, setNewCardError] = useState<string | null>(null);

  const openCardIdRef = useRef<WebCardId | null>(null);
  openCardIdRef.current = openCardId;
  const entriesByCardRef = useRef<Record<string, WebChatEntry[]>>({});
  entriesByCardRef.current = entriesByCard;

  const loadBoardCards = useCallback(async (): Promise<void> => {
    const outcome = await fetchCards();
    if (outcome.ok) {
      setCards(outcome.data);
      return;
    }
    if (outcome.status === 401) {
      setSession({ kind: "unauthenticated", returnTo: window.location.pathname + window.location.search });
      return;
    }
    setBoardNotice(outcome.error);
  }, []);

  const loadCardChat = useCallback(async (cardId: WebCardId, afterSeq = 0): Promise<void> => {
    if (afterSeq === 0) setChatLoading(true);
    setChatError(null);
    const outcome = await fetchChatEntries(cardId, afterSeq);
    if (afterSeq === 0) setChatLoading(false);
    if (!outcome.ok) {
      if (outcome.status === 403 || outcome.status === 404) {
        setCards((prev) => removeCardFromList(prev, cardId));
        setOpenCardId((current) => (current === cardId ? null : current));
        setBoardNotice("This card is no longer available.");
        return;
      }
      setChatError(outcome.error);
      return;
    }
    setEntriesByCard((prev) => ({
      ...prev,
      [cardId]: mergeChatEntries(prev[cardId] ?? [], outcome.data),
    }));
    setLoginByUserId((prev) => {
      const next = { ...prev };
      for (const entry of outcome.data) next[entry.authorId] = entry.authorLogin;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap(): Promise<void> {
      const currentPath = window.location.pathname + window.location.search;
      const inviteToken = extractInviteTokenFromPath(window.location.pathname);
      const meOutcome = await fetchMe();
      if (cancelled) return;
      if (!meOutcome.ok || !meOutcome.data.ok) {
        if (inviteToken !== null) {
          window.location.assign("/v1/auth/github?returnTo=" + encodeURIComponent(window.location.pathname));
          return;
        }
        setSession({ kind: "unauthenticated", returnTo: currentPath || "/" });
        return;
      }
      const user = meOutcome.data.user;
      setLoginByUserId((prev) => ({ ...prev, [user.id]: user.login }));
      if (inviteToken !== null) {
        setSession({ kind: "invite-redeeming", user, token: inviteToken });
        const redeemOutcome = await redeemInvite(inviteToken);
        if (cancelled) return;
        if (!redeemOutcome.ok) {
          setSession({ kind: "invite-invalid", user });
          return;
        }
        window.history.replaceState(null, "", "/");
        setSession({ kind: "board", user });
        setCards((prev) => upsertCard(prev, redeemOutcome.data));
        setOpenCardId(redeemOutcome.data.id);
        await loadBoardCards();
        await loadCardChat(redeemOutcome.data.id, 0);
        return;
      }
      setSession({ kind: "board", user });
      await loadBoardCards();
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [loadBoardCards, loadCardChat]);

  const applyLiveFrame = useCallback((frame: WebLiveFrame): void => {
    switch (frame.kind) {
      case "card_created": {
        const parsedCard = parseWebCard(frame.rawCard);
        if (parsedCard !== null) setCards((prev) => upsertCard(prev, parsedCard));
        return;
      }
      case "card_moved": {
        if (isWebCardId(frame.cardId)) {
          const movedId = frame.cardId;
          setCards((prev) => moveCardInList(prev, movedId, frame.column));
        }
        return;
      }
      case "message_created": {
        const parsedEntry = parseWebChatEntry(frame.rawEntry);
        if (parsedEntry === null) return;
        setEntriesByCard((prev) => ({
          ...prev,
          [parsedEntry.cardId]: mergeChatEntries(prev[parsedEntry.cardId] ?? [], [parsedEntry]),
        }));
        setLoginByUserId((prev) => ({ ...prev, [parsedEntry.authorId]: parsedEntry.authorLogin }));
        if (isWebCardId(parsedEntry.cardId) && isCardMemberId(parsedEntry.authorId)) {
          const entryCardId = parsedEntry.cardId;
          const entryMemberId = parsedEntry.authorId;
          setCards((prev) => ensureCardMember(prev, entryCardId, entryMemberId));
        }
        return;
      }
      case "card_removed": {
        if (!isWebCardId(frame.cardId)) return;
        const removedId = frame.cardId;
        setCards((prev) => removeCardFromList(prev, removedId));
        setEntriesByCard((prev) => {
          if (!(removedId in prev)) return prev;
          const next = { ...prev };
          delete next[removedId];
          return next;
        });
        if (openCardIdRef.current === removedId) {
          setOpenCardId(null);
          setBoardNotice("This card was removed from your board and its chat has closed.");
        }
        return;
      }
    }
  }, []);

  useEffect(() => {
    if (session.kind !== "board") return;
    const source = new EventSource("/v1/stream");
    let openedOnce = false;
    let needsCatchUp = false;

    source.onopen = () => {
      if (openedOnce && needsCatchUp) {
        needsCatchUp = false;
        void loadBoardCards();
        const activeId = openCardIdRef.current;
        if (activeId !== null) {
          const afterSeq = lastSeqOf(entriesByCardRef.current[activeId] ?? []);
          void loadCardChat(activeId, afterSeq);
        }
      }
      openedOnce = true;
    };

    source.onerror = () => {
      if (openedOnce) needsCatchUp = true;
    };

    const listeners: Array<{ kind: WebLiveFrameKind; fn: (domEvt: Event) => void }> = LIVE_FRAME_KINDS.map((kind) => {
      const fn = (domEvt: Event): void => {
        if (!hasDataPayload(domEvt) || typeof domEvt.data !== "string") return;
        const frame = parseLiveFrame(kind, domEvt.data);
        if (frame !== null) applyLiveFrame(frame);
      };
      source.addEventListener(kind, fn);
      return { kind, fn };
    });

    return () => {
      for (const { kind, fn } of listeners) source.removeEventListener(kind, fn);
      source.close();
    };
  }, [session.kind, applyLiveFrame, loadBoardCards, loadCardChat]);

  function openChatForCard(cardId: WebCardId): void {
    setBoardNotice(null);
    setOpenCardId(cardId);
    const existing = entriesByCard[cardId] ?? [];
    void loadCardChat(cardId, existing.length > 0 ? lastSeqOf(existing) : 0);
    if (session.kind === "board" && session.user.isOwner) {
      void loadBoardCards();
    }
  }

  async function onCreateCard(title: string): Promise<void> {
    setNewCardBusy(true);
    setNewCardError(null);
    const outcome = await createCard(title);
    setNewCardBusy(false);
    if (!outcome.ok) {
      setNewCardError(outcome.error);
      return;
    }
    setCards((prev) => upsertCard(prev, outcome.data));
    setNewCardOpen(false);
  }

  async function onMoveColumn(cardId: WebCardId, column: CardColumn): Promise<void> {
    const outcome = await moveCard(cardId, column);
    if (outcome.ok) {
      setCards((prev) => upsertCard(prev, outcome.data));
      return;
    }
    setBoardNotice(outcome.error);
  }

  async function onCopyInvite(cardId: WebCardId): Promise<void> {
    const outcome = await createInviteLink(cardId);
    if (!outcome.ok) {
      setBoardNotice(outcome.error);
      return;
    }
    const inviteUrl = outcome.data.url;
    setCopiedInvites((prev) => ({ ...prev, [cardId]: inviteUrl }));
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(inviteUrl).catch(() => undefined);
    }
  }

  async function onRemoveMember(cardId: WebCardId, memberId: CardMemberId): Promise<void> {
    const outcome = await removeCardMember(cardId, memberId);
    if (!outcome.ok) {
      setBoardNotice(outcome.error);
      return;
    }
    setCards((prev) => removeCardMemberFromList(prev, cardId, memberId));
    setCopiedInvites((prev) => {
      if (!(cardId in prev)) return prev;
      const next = { ...prev };
      delete next[cardId];
      return next;
    });
  }

  async function onCloseSharing(cardId: WebCardId): Promise<void> {
    const outcome = await closeCardSharing(cardId);
    if (!outcome.ok) {
      setBoardNotice(outcome.error);
      return;
    }
    setCards((prev) => closeCardSharingInList(prev, cardId));
    setCopiedInvites((prev) => {
      if (!(cardId in prev)) return prev;
      const next = { ...prev };
      delete next[cardId];
      return next;
    });
  }

  async function onDeleteCard(cardId: WebCardId): Promise<void> {
    const outcome = await deleteCard(cardId);
    if (!outcome.ok) {
      setBoardNotice(outcome.error);
      return;
    }
    setCards((prev) => removeCardFromList(prev, cardId));
    if (openCardId === cardId) setOpenCardId(null);
  }

  async function onPostEntry(text: string, replyToId: WebChatEntryId | null): Promise<boolean> {
    if (openCardId === null) return false;
    setChatError(null);
    const outcome = await postChatEntry({ cardId: openCardId, text, replyToId });
    if (!outcome.ok) {
      if (outcome.status === 403 || outcome.status === 404) {
        setCards((prev) => removeCardFromList(prev, openCardId));
        setOpenCardId(null);
        setBoardNotice("This card is no longer available.");
        return false;
      }
      setChatError(outcome.error);
      return false;
    }
    setEntriesByCard((prev) => ({
      ...prev,
      [openCardId]: mergeChatEntries(prev[openCardId] ?? [], [outcome.data]),
    }));
    return true;
  }

  async function onSignOut(): Promise<void> {
    await postLogout();
    setCards([]);
    setOpenCardId(null);
    setEntriesByCard({});
    setSession({ kind: "unauthenticated", returnTo: "/" });
  }

  if (session.kind === "loading" || session.kind === "invite-redeeming") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          {session.kind === "invite-redeeming" ? "Joining card..." : "Loading board..."}
        </p>
      </main>
    );
  }

  if (session.kind === "unauthenticated") {
    return <AuthScreen returnTo={session.returnTo} />;
  }

  if (session.kind === "invite-invalid") {
    return (
      <InviteInvalidScreen
        login={session.user.login}
        onGoToBoard={() => {
          window.history.replaceState(null, "", "/");
          setSession({ kind: "board", user: session.user });
          void loadBoardCards();
        }}
      />
    );
  }

  const openCard = openCardId === null ? null : (cards.find((card) => card.id === openCardId) ?? null);
  const showEmptyInviteeNotice = !session.user.isOwner && cards.length === 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-6">
      <BoardHeader
        user={session.user}
        onOpenNewCard={() => {
          setNewCardError(null);
          setNewCardOpen(true);
        }}
        onSignOut={() => {
          void onSignOut();
        }}
      />

      {boardNotice !== null ? (
        <div
          role="status"
          data-testid="board-notice"
          className="flex items-center justify-between rounded-md border bg-muted px-4 py-2.5 text-sm"
        >
          <span>{boardNotice}</span>
          <button
            type="button"
            className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setBoardNotice(null);
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {showEmptyInviteeNotice ? (
        <Card data-testid="empty-invitee-notice">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No cards yet — ask the owner for an invite.</p>
          </CardContent>
        </Card>
      ) : (
        <section aria-label="Board" className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
          {BOARD_COLUMNS.map(({ column, title }) => {
            const columnCards = cards.filter((card) => card.column === column);
            return (
              <Card key={column} data-testid={"column-" + column}>
                <CardHeader>
                  <h2 className="text-base leading-snug font-medium">
                    {title} ({columnCards.length})
                  </h2>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {columnCards.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No cards yet.</p>
                  ) : (
                    columnCards.map((card) => (
                      <CardItem
                        key={card.id}
                        card={card}
                        isOwner={session.user.isOwner}
                        isSelected={openCardId === card.id}
                        copiedInviteUrl={copiedInvites[card.id] ?? null}
                        loginByUserId={loginByUserId}
                        onOpenChat={openChatForCard}
                        onMoveColumn={onMoveColumn}
                        onCopyInvite={onCopyInvite}
                        onRemoveMember={onRemoveMember}
                        onCloseSharing={onCloseSharing}
                        onDeleteCard={onDeleteCard}
                      />
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}

      {openCard !== null ? (
        <CardChatPanel
          card={openCard}
          entries={entriesByCard[openCard.id] ?? []}
          loading={chatLoading}
          errorNotice={chatError}
          onClose={() => {
            setOpenCardId(null);
          }}
          onPostEntry={onPostEntry}
        />
      ) : null}

      {newCardOpen ? (
        <NewCardDialog
          busy={newCardBusy}
          errorNotice={newCardError}
          onCancel={() => {
            setNewCardOpen(false);
          }}
          onCreate={onCreateCard}
        />
      ) : null}
    </main>
  );
}
