import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import type { ResearchRow } from "@/lib/interview/store";

const PENDING = new Set(["queued", "running"]);
const FAILED = new Set(["failed", "incomplete"]);

/** Research rows, each showing its own state, so results appear one by one as they finish. */
export function ResearchList({ rows, empty }: { rows: ResearchRow[]; empty: string }) {
  if (!rows.length) return <p className="flex items-center gap-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ItemGroup className="gap-2">
      {rows.map((r) => (
        <Item key={r.id} variant="outline" size="sm" render={<Link href={`/interview/reports/${r.id}`} />}>
          <ItemContent>
            <ItemTitle>{r.question}</ItemTitle>
            {PENDING.has(r.status) ? <ItemDescription>Looking this up in public records…</ItemDescription> : null}
            {FAILED.has(r.status) ? <ItemDescription>We couldn&apos;t finish this one right now.</ItemDescription> : null}
          </ItemContent>
          <ItemActions>
            {PENDING.has(r.status) ? <Spinner aria-label="Looking this up" />
              : r.status === "completed" ? <Badge>Ready</Badge>
              : FAILED.has(r.status) ? <Badge variant="outline">Unavailable</Badge>
              : <Badge variant="outline">{r.status}</Badge>}
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}
