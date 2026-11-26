import { useRef, useState } from "react";
import { CornerDownRight, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { applyWaiterMention, findWaiterMentionMatch, groupChatThreads } from "@/lib/board-state";
import type { WaiterMentionMatch } from "@/lib/board-state";
import type { WebCard, WebCardId } from "../../modules/cards/web";
import type { WebChatEntry, WebChatEntryId } from "../../modules/chat/web";

export interface CardChatPanelProps {
  readonly card: WebCard;
  readonly entries: readonly WebChatEntry[];
  readonly loading: boolean;
  readonly errorNotice: string | null;
  readonly onClose: () => void;
  readonly onPostEntry: (cardId: WebCardId, text: string, replyToId: WebChatEntryId | null) => Promise<boolean>;
}

interface EntryRowProps {
  readonly entry: WebChatEntry;
  readonly isReply: boolean;
  readonly onReply: (entry: WebChatEntry) => void;
}

function EntryRow({ entry, isReply, onReply }: EntryRowProps): React.JSX.Element {
  return (
    <div
      data-testid={"chat-entry-" + String(entry.seq)}
      data-entry-seq={String(entry.seq)}
      className={isReply ? "ml-6 border-l-2 border-border pl-3 py-1" : "rounded-md border bg-card p-2.5"}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">{entry.authorLogin}</span>
          <span className="text-[11px] text-muted-foreground">#{entry.seq}</span>
          {entry.mentionsWaiter ? <Badge variant="secondary">@waiter</Badge> : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onReply(entry);
          }}
        >
          <CornerDownRight className="size-3" />
          Reply
        </Button>
      </div>
      <p className="mt-1 text-sm whitespace-pre-wrap">{entry.text}</p>
    </div>
  );
}

export function CardChatPanel({
  card,
  entries,
  loading,
  errorNotice,
  onClose,
  onPostEntry,
}: CardChatPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [mentionMatch, setMentionMatch] = useState<WaiterMentionMatch | null>(null);
  const [replyingTo, setReplyingTo] = useState<WebChatEntry | null>(null);
  const [sending, setSending] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const threads = groupChatThreads(entries);

  function updateDraft(nextText: string, cursor: number): void {
    setDraft(nextText);
    setMentionMatch(findWaiterMentionMatch(nextText, cursor));
  }

  function pickWaiterMention(): void {
    if (mentionMatch === null) return;
    const applied = applyWaiterMention(draft, mentionMatch);
    setDraft(applied.nextText);
    setMentionMatch(null);
    const area = composerRef.current;
    if (area !== null) {
      area.focus();
      area.setSelectionRange(applied.nextCursor, applied.nextCursor);
    }
  }

  async function submitDraft(): Promise<void> {
    const trimmed = draft.trim();
    if (trimmed === "" || sending) return;
    setSending(true);
    const ok = await onPostEntry(card.id, trimmed, replyingTo?.id ?? null);
    setSending(false);
    if (ok) {
      setDraft("");
      setMentionMatch(null);
      setReplyingTo(null);
    }
  }

  function onComposerKeyDown(keyEvt: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (mentionMatch !== null) {
      if (keyEvt.key === "Enter" || keyEvt.key === "Tab") {
        keyEvt.preventDefault();
        pickWaiterMention();
        return;
      }
      if (keyEvt.key === "Escape") {
        keyEvt.preventDefault();
        setMentionMatch(null);
        return;
      }
    }
    if (keyEvt.key === "Enter" && !keyEvt.shiftKey) {
      keyEvt.preventDefault();
      void submitDraft();
    }
  }

  return (
    <Card data-testid="card-chat-panel" data-card-id={card.id} className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between border-b pb-3">
        <div>
          <CardTitle>{card.title}</CardTitle>
          <p className="text-xs text-muted-foreground">Live thread ({entries.length})</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close chat" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex max-h-96 flex-col gap-3 overflow-y-auto py-4">
        {loading ? <p className="text-sm text-muted-foreground">Loading thread...</p> : null}
        {!loading && threads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries yet. Start the thread or mention @waiter.</p>
        ) : null}
        {threads.map(({ root, replies }) => (
          <div key={root.id} className="flex flex-col gap-1.5">
            <EntryRow entry={root} isReply={false} onReply={setReplyingTo} />
            {replies.map((reply) => (
              <EntryRow key={reply.id} entry={reply} isReply={true} onReply={setReplyingTo} />
            ))}
          </div>
        ))}
        {errorNotice !== null ? <p className="text-xs text-destructive">{errorNotice}</p> : null}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2">
        {replyingTo !== null ? (
          <div className="flex items-center justify-between rounded bg-background px-2.5 py-1 text-xs">
            <span className="truncate text-muted-foreground">
              Replying to {replyingTo.authorLogin}: {replyingTo.text}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Cancel reply"
              onClick={() => {
                setReplyingTo(null);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null}
        <div className="relative flex flex-col gap-2">
          {mentionMatch !== null ? (
            <div
              role="listbox"
              aria-label="Mention picker"
              data-testid="mention-picker"
              className="absolute bottom-full left-0 z-20 mb-1 w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              <button
                type="button"
                role="option"
                aria-selected="true"
                data-testid="mention-option-waiter"
                onMouseDown={(mouseEvt) => {
                  mouseEvt.preventDefault();
                  pickWaiterMention();
                }}
                onClick={pickWaiterMention}
                className="flex w-full cursor-pointer items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="font-medium">@waiter</span>
                <span className="text-xs text-muted-foreground">Mention waiter</span>
              </button>
            </div>
          ) : null}
          <Textarea
            ref={composerRef}
            aria-label="Chat composer"
            placeholder="Write a note... Type @ to mention @waiter"
            value={draft}
            disabled={sending}
            onChange={(changeEvt) => {
              const area = changeEvt.currentTarget;
              updateDraft(area.value, area.selectionStart ?? area.value.length);
            }}
            onKeyDown={onComposerKeyDown}
          />
          <div className="flex justify-end">
            <Button
              disabled={sending || draft.trim() === ""}
              onClick={() => {
                void submitDraft();
              }}
            >
              <Send className="size-3.5" />
              Send
            </Button>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}
