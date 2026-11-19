"use client";
import { Page } from "@/components/gov/ui";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export default function InterviewError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Page narrow>
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Couldn&apos;t load this page</EmptyTitle>
          <EmptyDescription>The interview service is unavailable.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent><Button variant="outline" onClick={reset}>Try again</Button></EmptyContent>
      </Empty>
    </Page>
  );
}
