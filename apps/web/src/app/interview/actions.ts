"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { readFlags } from "@/lib/flags";
import { rememberOwner } from "@/lib/interview/access";
import { canSeeStudy, requireStaff } from "@/lib/interview/staff";
import { publicError } from "@/lib/interview/guard";
import { InvalidInput, parseDemographics, parseStudy } from "@/lib/interview/parse";
import { queuePeriodicResearch, runResearch } from "@/lib/interview/research";
import { completedSessions, createSession, createStudy, getStudy, hasTakenStudy, InterviewError, recordPayment, recordPayout, studyInterviewCount } from "@/lib/interview/store";
import { stripe } from "@/lib/interview/stripe";
import { studyFields, studyProductName } from "@/lib/interview/taxonomy";

export type ActionState = { error?: string; notice?: string } | undefined;

function guard() {
  if (!readFlags().INTERVIEW_PREVIEW) throw new InterviewError("not_found", "Not found.", 404);
}

function failure(error: unknown): ActionState {
  if (error instanceof InvalidInput) return { error: error.message };
  if (error instanceof InterviewError) return { error: publicError(error, "interview action").message };
  console.error("interview action", error);
  return { error: "Something went wrong. Try again." };
}

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3001";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function startInterview(_: ActionState, form: FormData): Promise<ActionState> {
  let id: string;
  try {
    guard();
    const studyId = String(form.get("studyId") ?? "");
    const study = studyId ? await getStudy(studyId) : null;
    if (studyId && study?.status !== "open") throw new InterviewError("closed", "This study isn't open yet.");
    if (study && await studyInterviewCount(study.id) >= study.interviewTarget) throw new InterviewError("full", "This study is full. Thanks for your interest.");
    const person = parseDemographics(form, studyFields(study));
    if (study && await hasTakenStudy(person.rewardEmail, study.id)) throw new InterviewError("taken", "You've already taken this study. Thanks again.");
    id = await createSession({ ...person, studyId: study?.id ?? null });
    await rememberOwner(id);
  } catch (error) { return failure(error); }
  redirect(`/interview/${id}`);
}

/** Saves a sponsor's study as a draft; it opens once paid for. */
export async function saveStudy(_: ActionState, form: FormData): Promise<ActionState> {
  let id: string;
  try {
    guard();
    id = await createStudy(parseStudy(form));
    // This browser owns the study's results; voters only ever get the share link.
    await rememberOwner(id);
  } catch (error) { return failure(error); }
  redirect(`/interview/studies/${id}`);
}

/** Opens Stripe Checkout (test mode) to launch a study at its chosen size. Research and reports are free. */
export async function checkout(_: ActionState, form: FormData): Promise<ActionState> {
  let url: string;
  try {
    guard();
    const studyId = typeof form.get("studyId") === "string" ? String(form.get("studyId")) : "";
    const study = studyId ? await getStudy(studyId) : null;
    if (!study || !await canSeeStudy(study.id)) throw new InterviewError("not_found", "Study not found.", 404);
    if (study.status === "open") throw new InterviewError("open", "This study is already live.");
    const cents = study.priceCents;
    const name = studyProductName(study.interviewTarget);
    const base = await origin();
    const back = `${base}/interview/studies/${study.id}`;
    const created = await stripe("checkout/sessions", {
      params: {
        mode: "payment",
        success_url: `${base}/api/interview/checkout/return?cs={CHECKOUT_SESSION_ID}`,
        cancel_url: `${back}?checkout=cancelled`,
        "line_items[0][quantity]": 1,
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": cents,
        "line_items[0][price_data][product_data][name]": name,
        "metadata[product]": "study",
        "metadata[study_id]": study.id,
        "payment_intent_data[description]": name,
      },
    });
    if (typeof created.url !== "string") throw new InterviewError("stripe_error", "Stripe did not return a checkout link.", 502);
    url = created.url;
  } catch (error) { return failure(error); }
  redirect(url);
}

export async function runPeriodicNow(): Promise<ActionState> {
  try {
    guard();
    await requireStaff();
    const jobs = await queuePeriodicResearch(await completedSessions(2000, { publicOnly: true }));
    after(() => Promise.all(jobs.map(([id, q]) => runResearch(id, q))));
    revalidatePath("/interview/insights");
    return { notice: jobs.length ? `Started ${jobs.length} research run${jobs.length === 1 ? "" : "s"}: ${jobs.map(([, q]) => q).join(" · ")}` : "Nothing new to research: each top issue from the last week was researched in the last day." };
  } catch (error) { return failure(error); }
}

/** Adds funds that are available immediately, using Stripe's documented test payment method. */
export async function topUpTestBalance(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    guard();
    await requireStaff();
    const cents = Math.min(Math.max(Math.round(Number(form.get("dollars")) * 100) || 0, 100), 100_000);
    const intent = await stripe("payment_intents", {
      params: {
        amount: cents, currency: "usd", confirm: true, payment_method: "pm_card_bypassPending",
        "automatic_payment_methods[enabled]": true, "automatic_payment_methods[allow_redirects]": "never",
        description: "Aletheia interview prototype: test balance top-up",
      },
    });
    await recordPayment({ sessionId: null, product: "test_top_up", stripeId: String(intent.id), amountCents: cents, status: String(intent.status) === "succeeded" ? "paid" : String(intent.status) });
    revalidatePath("/interview/payouts");
    return { notice: `Added $${(cents / 100).toFixed(2)}.` };
  } catch (error) { return failure(error); }
}

/** Pays out from the Stripe test balance to the account's test bank account. */
export async function sendTestPayout(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    guard();
    await requireStaff();
    const cents = Math.min(Math.max(Math.round(Number(form.get("dollars")) * 100) || 0, 100), 100_000);
    const note = String(form.get("note") ?? "").replace(/\s+/gu, " ").trim().slice(0, 120) || null;
    const payout = await stripe("payouts", { params: { amount: cents, currency: "usd", description: note ?? "Aletheia interview prototype payout" } }).catch((error: unknown) => {
      if (error instanceof InterviewError && /external accounts/iu.test(error.message)) {
        throw new InterviewError("no_bank", "There's no bank account to pay out to yet. Add one in the Stripe dashboard under Settings → Payouts.", 400);
      }
      throw error;
    });
    await recordPayout({ stripeId: String(payout.id), amountCents: cents, status: String(payout.status), note });
    revalidatePath("/interview/payouts");
    return { notice: `Payout ${String(payout.id)} created (${String(payout.status)}).` };
  } catch (error) { return failure(error); }
}
