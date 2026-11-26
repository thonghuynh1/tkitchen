import { LogIn } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface AuthScreenProps {
  readonly returnTo: string;
}

export function AuthScreen({ returnTo }: AuthScreenProps): React.JSX.Element {
  const signInHref = "/v1/auth/github?returnTo=" + encodeURIComponent(returnTo);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Waiter Board</CardTitle>
          <CardDescription>Sign in with GitHub to view cards and join live threads.</CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href={signInHref}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <LogIn className="size-4" />
            Sign in with GitHub
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
