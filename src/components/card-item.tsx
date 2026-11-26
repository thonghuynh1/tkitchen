import { useState } from "react";
import { Link2, Lock, MessageSquare, Trash2, UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BOARD_COLUMNS } from "@/lib/board-state";
import type { CardColumn, CardMemberId, WebCard, WebCardId } from "../../modules/cards/web";

export interface CardItemProps {
  readonly card: WebCard;
  readonly isOwner: boolean;
  readonly isSelected: boolean;
  readonly copiedInviteUrl: string | null;
  readonly loginByUserId: Readonly<Record<string, string>>;
  readonly onOpenChat: (cardId: WebCardId) => void;
  readonly onMoveColumn: (cardId: WebCardId, column: CardColumn) => Promise<void>;
  readonly onCopyInvite: (cardId: WebCardId) => Promise<void>;
  readonly onRemoveMember: (cardId: WebCardId, memberId: CardMemberId) => Promise<void>;
  readonly onCloseSharing: (cardId: WebCardId) => Promise<void>;
  readonly onDeleteCard: (cardId: WebCardId) => Promise<void>;
}

export function CardItem({
  card,
  isOwner,
  isSelected,
  copiedInviteUrl,
  loginByUserId,
  onOpenChat,
  onMoveColumn,
  onCopyInvite,
  onRemoveMember,
  onCloseSharing,
  onDeleteCard,
}: CardItemProps): React.JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const nonOwnerMembers = card.memberIds.filter((memberId) => memberId !== card.ownerId);

  return (
    <Card
      size="sm"
      data-testid={"card-" + card.id}
      data-card-title={card.title}
      data-card-column={card.column}
      className={isSelected ? "ring-2 ring-primary" : undefined}
    >
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onOpenChat(card.id);
            }}
            className="cursor-pointer text-left hover:underline"
          >
            <CardTitle>{card.title}</CardTitle>
          </button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={"Open chat for " + card.title}
            onClick={() => {
              onOpenChat(card.id);
            }}
          >
            <MessageSquare className="size-3.5" />
            Chat
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1" aria-label="Move column">
          {BOARD_COLUMNS.map(({ column, title }) => (
            <Button
              key={column}
              variant={card.column === column ? "default" : "outline"}
              size="sm"
              disabled={card.column === column}
              onClick={() => {
                void onMoveColumn(card.id, column);
              }}
            >
              {title}
            </Button>
          ))}
        </div>
      </CardHeader>
      {isOwner ? (
        <CardContent className="flex flex-col gap-2 border-t pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void onCopyInvite(card.id);
              }}
            >
              <Link2 className="size-3.5" />
              Copy invite link
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void onCloseSharing(card.id);
              }}
            >
              <Lock className="size-3.5" />
              Close sharing
            </Button>
            {confirmingDelete ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setConfirmingDelete(false);
                    void onDeleteCard(card.id);
                  }}
                >
                  Confirm delete
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConfirmingDelete(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  setConfirmingDelete(true);
                }}
              >
                <Trash2 className="size-3.5" />
                Delete card
              </Button>
            )}
          </div>
          {copiedInviteUrl !== null ? (
            <div className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs">
              <span className="truncate font-mono" data-testid={"invite-url-" + card.id}>
                {copiedInviteUrl}
              </span>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Members ({card.memberIds.length})</span>
            <ul className="flex flex-col gap-1">
              {nonOwnerMembers.length === 0 ? (
                <li className="text-xs text-muted-foreground">Only you</li>
              ) : (
                nonOwnerMembers.map((memberId) => {
                  const display = loginByUserId[memberId] ?? memberId;
                  return (
                    <li
                      key={memberId}
                      data-testid={"member-" + memberId}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <Badge variant="outline">{display}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={"Remove " + display}
                        onClick={() => {
                          void onRemoveMember(card.id, memberId);
                        }}
                      >
                        <UserMinus className="size-3" />
                        Remove
                      </Button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
