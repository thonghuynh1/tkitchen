import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export interface InviteInvalidScreenProps {
  readonly login: string;
  readonly onGoToBoard: () => void;
}

export function InviteInvalidScreen({ login, onGoToBoard }: InviteInvalidScreenProps): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>This invite link is no longer valid</CardTitle>
          <CardDescription>
            Signed in as {login}. The owner may have revoked the link, closed sharing, or deleted the card.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Ask the board owner for a fresh invite link to join.</p>
        </CardContent>
        <CardFooter>
          <Button onClick={onGoToBoard} className="w-full">
            Go to board
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
