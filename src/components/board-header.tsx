import { LogOut, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MeUser } from "../../modules/identities/web";

export interface BoardHeaderProps {
  readonly user: MeUser;
  readonly onOpenNewCard: () => void;
  readonly onSignOut: () => void;
}

export function BoardHeader({ user, onOpenNewCard, onSignOut }: BoardHeaderProps): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Waiter Board</h1>
        {user.isOwner ? <Badge variant="secondary">Owner</Badge> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {user.isOwner ? (
          <Button onClick={onOpenNewCard}>
            <Plus className="size-4" />
            New card
          </Button>
        ) : null}
        <span data-testid="signed-in-login" className="px-2 text-sm text-muted-foreground">
          {user.login}
        </span>
        <Button variant="outline" size="sm" onClick={onSignOut}>
          <LogOut className="size-3.5" />
          Sign out
        </Button>
      </div>
    </header>
  );
}
