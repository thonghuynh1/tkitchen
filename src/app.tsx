import { Card, CardContent, CardHeader } from "@/components/ui/card";

type Column = "todo" | "doing" | "done";

interface BoardColumn {
  readonly column: Column;
  readonly title: string;
}

const COLUMNS: readonly BoardColumn[] = [
  { column: "todo", title: "Todo" },
  { column: "doing", title: "Doing" },
  { column: "done", title: "Done" },
];

export function App(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Waiter Board</h1>
      </header>
      <section aria-label="Board" className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
        {COLUMNS.map(({ column, title }) => (
          <Card key={column}>
            <CardHeader>
              <h2 className="text-base leading-snug font-medium">{title}</h2>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">No cards yet.</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
