import type { ReactNode } from "react";
import { Page, PageTitle } from "@/components/gov/ui";

export function DraftPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Page narrow>
      <PageTitle title={title} />
      <div className="flex flex-col gap-6 leading-7 text-muted-foreground [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_section]:flex [&_section]:flex-col [&_section]:gap-2">{children}</div>
    </Page>
  );
}
