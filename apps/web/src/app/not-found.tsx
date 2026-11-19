import Link from "next/link";
import { Page, PageTitle } from "@/components/gov/ui";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <Page narrow>
      <PageTitle title="We couldn’t find that page">The link may be old, or the page may have moved.</PageTitle>
      <div className="flex flex-wrap gap-3">
        <Button nativeButton={false} render={<Link href="/" />}>Ask a question</Button>
      </div>
    </Page>
  );
}
