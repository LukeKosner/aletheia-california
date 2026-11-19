import { hasCardTeamSession, PRIVATE_HEADERS } from "./access";
import { PREVIEW_ID, recordedCard } from "./model";
import { renderCard } from "./image";
import { readFlags } from "@/lib/flags";

export async function GET(request: Request) {
  if (!await hasCardTeamSession()) return Response.json({ error: "Team sign-in required." }, { status: 401, headers: PRIVATE_HEADERS });
  const url = new URL(request.url);
  if (url.searchParams.get("id") !== PREVIEW_ID) return Response.json({ error: "Card not found." }, { status: 404, headers: PRIVATE_HEADERS });
  if (url.searchParams.get("preview") !== "1") {
    const error = !readFlags().CARDS_PUBLIC
      ? "Public card export is disabled."
      : "Public export requires supported verifier claims, human approval and connected publication state. This card is an unverified recorded preview.";
    return Response.json({ error }, { status: 409, headers: PRIVATE_HEADERS });
  }
  const layout = url.searchParams.get("layout") ?? "wide";
  if (layout !== "wide" && layout !== "tall") return Response.json({ error: "Choose wide or tall." }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    // No caller-controlled content, origin override, filename, URL fetch or secret lookup.
    return await renderCard(recordedCard(), url.origin, layout === "tall");
  } catch {
    return Response.json({ error: "Card preview unavailable. No export was approved." }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
