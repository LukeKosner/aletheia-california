import { NextResponse } from "next/server";
import { apiError, checkApi, UUID } from "@/lib/interview/guard";
import { InterviewError, openStudy, recordPayment } from "@/lib/interview/store";
import { stripe } from "@/lib/interview/stripe";

/**
 * Stripe Checkout success URL. Confirms payment with Stripe (test mode), records it once, then opens the
 * study. Studies are the only paid product: research and reports are free and need no checkout.
 */
export async function GET(request: Request) {
  try {
    checkApi(request);
    const url = new URL(request.url);
    const cs = url.searchParams.get("cs") ?? "";
    if (!/^cs_test_[A-Za-z0-9]+$/u.test(cs)) throw new InterviewError("invalid_session", "Unknown checkout session.", 400);
    const checkout = await stripe(`checkout/sessions/${cs}`);
    const meta = (checkout.metadata ?? {}) as Record<string, string>;
    const studyId = meta.product === "study" && UUID.test(meta.study_id ?? "") ? meta.study_id : null;
    if (!studyId) return NextResponse.redirect(new URL("/interview/insights", url));
    if (checkout.payment_status !== "paid") return NextResponse.redirect(new URL(`/interview/studies/${studyId}?checkout=unpaid`, url));
    await recordPayment({ sessionId: null, product: "study", stripeId: cs, amountCents: Number(checkout.amount_total) || 0, status: "paid" });
    await openStudy(studyId);
    return NextResponse.redirect(new URL(`/interview/studies/${studyId}?checkout=paid`, url));
  } catch (error) { return apiError(error); }
}
