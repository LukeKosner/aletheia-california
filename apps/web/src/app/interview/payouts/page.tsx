import { Suspense } from "react";
import { connection } from "next/server";
import { Page, PageTitle, Section, Skeleton } from "@/components/gov/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { requirePreview } from "@/lib/interview/guard";
import { isStaff } from "@/lib/interview/staff";
import { InterviewError, listPayments, listPayouts } from "@/lib/interview/store";
import { stripe } from "@/lib/interview/stripe";
import { dollars } from "@/lib/interview/taxonomy";
import { runPeriodicNow, sendTestPayout, topUpTestBalance } from "../actions";
import { ActionForm, TextField } from "../forms";

export const metadata = { title: "Payouts · Aletheia" };

type Amount = { amount: number; currency: string };

async function balance(): Promise<{ available: number; pending: number; error: string | null }> {
  try {
    const b = await stripe("balance");
    const sum = (list: unknown) => (Array.isArray(list) ? (list as Amount[]) : []).filter((x) => x.currency === "usd").reduce((t, x) => t + x.amount, 0);
    return { available: sum(b.available), pending: sum(b.pending), error: null };
  } catch (e) { return { available: 0, pending: 0, error: e instanceof InterviewError ? e.message : "Stripe is unavailable." }; }
}

const PRODUCT: Record<string, string> = { research: "Research", reports_pass: "Reports pass", study: "Study", test_top_up: "Top-up" };
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

async function Content() {
  await connection();
  requirePreview();
  if (!await isStaff()) return <Page narrow><PageTitle title="Administrator access required" /><p className="text-muted-foreground">Payouts are visible only to Aletheia administrators.</p></Page>;
  const [bal, payments, payouts] = await Promise.all([balance(), listPayments(), listPayouts()]);
  const sales = payments.filter((p) => p.status === "paid" && p.product !== "test_top_up").reduce((t, p) => t + p.amountCents, 0);
  const paidOut = payouts.filter((p) => p.status !== "owed").reduce((t, p) => t + p.amountCents, 0);
  const owed = payouts.filter((p) => p.status === "owed").reduce((t, p) => t + p.amountCents, 0);

  return (
    <Page narrow>
      <PageTitle title="Payouts" back={{ href: "/interview/insights", label: "Insights" }} />
      {bal.error ? <Alert variant="destructive"><AlertDescription>{bal.error}</AlertDescription></Alert> : null}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["Available", bal.available], ["Sales", sales], ["Owed to voters", owed], ["Paid out", paidOut]] as const).map(([k, v]) => (
          <Card key={k} size="sm"><CardContent><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-xl font-semibold tabular-nums">{dollars(v)}</dd></CardContent></Card>
        ))}
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Add funds</CardTitle></CardHeader>
          <CardContent>
            <ActionForm action={topUpTestBalance} label="Add" pendingLabel="Adding…" variant="outline">
              <TextField name="dollars" label="Dollars" type="number" defaultValue="25" className="w-28" />
            </ActionForm>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Pay out</CardTitle></CardHeader>
          <CardContent>
            <ActionForm action={sendTestPayout} label="Pay out" pendingLabel="Sending…">
              <TextField name="dollars" label="Dollars" type="number" defaultValue="5" className="w-28" />
              <TextField name="note" label="Note" placeholder="Optional" className="w-40" />
            </ActionForm>
          </CardContent>
        </Card>
      </div>
      <p className="-mt-6 text-xs text-muted-foreground">Card payments take a few days to clear. Add funds to pay out now.</p>

      <Section title="Weekly research">
        <ActionForm action={runPeriodicNow} label="Run now" pendingLabel="Starting…" variant="outline" />
      </Section>

      <Section title="Payouts">
        {payouts.length ? (
          <ItemGroup className="gap-2">
            {payouts.map((p) => (
              <Item key={p.id} variant="outline" size="sm">
                <ItemContent><ItemTitle className="tabular-nums">{dollars(p.amountCents)}</ItemTitle>{p.note ? <ItemDescription>{p.note}</ItemDescription> : null}</ItemContent>
                <ItemActions><span className="text-xs text-muted-foreground">{day(p.createdAt)}</span><Badge variant="outline">{p.status}</Badge></ItemActions>
              </Item>
            ))}
          </ItemGroup>
        ) : <p className="text-sm text-muted-foreground">None yet.</p>}
      </Section>

      <Section title="Payments">
        {payments.length ? (
          <ItemGroup className="gap-2">
            {payments.map((p) => (
              <Item key={p.id} variant="outline" size="sm">
                <ItemContent><ItemTitle className="tabular-nums">{dollars(p.amountCents)}</ItemTitle><ItemDescription>{PRODUCT[p.product] ?? p.product}</ItemDescription></ItemContent>
                <ItemActions><span className="text-xs text-muted-foreground">{day(p.createdAt)}</span><Badge variant="outline">{p.status}</Badge></ItemActions>
              </Item>
            ))}
          </ItemGroup>
        ) : <p className="text-sm text-muted-foreground">None yet.</p>}
      </Section>
    </Page>
  );
}

export default function Payouts() {
  requirePreview();
  return <Suspense fallback={<Page narrow><Skeleton /></Page>}><Content /></Suspense>;
}
