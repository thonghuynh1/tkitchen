import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface NewCardDialogProps {
  readonly busy: boolean;
  readonly errorNotice: string | null;
  readonly onCancel: () => void;
  readonly onCreate: (title: string) => Promise<void>;
}

export function NewCardDialog({ busy, errorNotice, onCancel, onCreate }: NewCardDialogProps): React.JSX.Element {
  const [title, setTitle] = useState("");

  function submitForm(formEvt: React.FormEvent<HTMLFormElement>): void {
    formEvt.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "" || busy) return;
    void onCreate(trimmed);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New card"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <Card className="w-full max-w-md shadow-lg">
        <form onSubmit={submitForm}>
          <CardHeader>
            <CardTitle>New card</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 py-4">
            <label htmlFor="new-card-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="new-card-title"
              autoFocus
              placeholder="Card title"
              value={title}
              onChange={(changeEvt) => {
                setTitle(changeEvt.currentTarget.value);
              }}
              disabled={busy}
            />
            {errorNotice !== null ? <p className="text-xs text-destructive">{errorNotice}</p> : null}
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || title.trim() === ""}>
              Create card
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
