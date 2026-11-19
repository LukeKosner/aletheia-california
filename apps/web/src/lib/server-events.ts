import "server-only";
import { createDb, event } from "@aletheia/db";
import { getGameActivity } from "@aletheia/tools";
import { headers } from "next/headers";
import { getAuth } from "./auth";
import { campusChoice, identityFromSession, roleUrl } from "./auth-policy";
import { resolvePublishedReceipt } from "./published-receipt";
import { verifiedEventReady, type FinalVerification } from "./event-policy";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function actor() {
  const auth = getAuth();
  if (!auth) return null;
  const session = await auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } });
  const identity = identityFromSession(session);
  return identity ? { ...identity, campus: campusChoice(session?.user.campus) } : null;
}
async function write(name: string, props: Record<string, string>, ownerId?: string | null) {
  const url = roleUrl(process.env.EVENT_WRITER_DATABASE_URL, "event_writer");
  if (!url) return false;
  const identity = await actor();
  if (!identity || (ownerId != null && ownerId !== identity.userId)) return false;
  // Only fixed server event names and IDs reach this INSERT-only role. It has
  // no SELECT/UPDATE/DELETE or grants on public filing/claim/auth tables.
  await createDb(url).insert(event).values({ name, userId: identity.userId, campus: identity.campus, props });
  return true;
}
/** Call only after the investigation has actually been persisted by the host. */
export async function recordInvestigationStarted(investigationId: string) {
  if (!uuid.test(investigationId)) return false;
  try {
    const stored = await getGameActivity(investigationId);
    if (!stored || !["running", "pending", "completed"].includes(stored.status)) return false;
    return await write("investigation_started", { investigation_id: investigationId }, stored.userId);
  } catch { return false; }
}
/** No browser action/endpoint calls this hook. Final P12 result + persisted exact
 * supported claims are both required. Pending/partial/failed never count. */
export async function recordInvestigationVerified(result: FinalVerification) {
  if (!uuid.test(result.investigation_id)) return false;
  try {
    const stored = await getGameActivity(result.investigation_id);
    if (!verifiedEventReady(result, stored)) return false;
    return await write("investigation_verified", { investigation_id: result.investigation_id, verification_status: "verified" }, stored?.userId);
  } catch { return false; }
}
/** The card response host calls after serving an actual published card view;
 * do not call on prefetch, card creation, preview, or a failed response. */
export async function recordCardViewed(cardId: string) {
  if (!uuid.test(cardId)) return false;
  try {
    const card = await resolvePublishedReceipt(cardId);
    return card ? await write("card_viewed", { card_id: card.id, investigation_id: card.investigationId }) : false;
  } catch { return false; }
}
export async function recordShareClicked(cardId: string, platform: "x" | "linkedin" | "bluesky" | "threads") {
  if (!uuid.test(cardId) || !["x", "linkedin", "bluesky", "threads"].includes(platform)) return false;
  try {
    const card = await resolvePublishedReceipt(cardId);
    return card ? await write("share_clicked", { card_id: card.id, investigation_id: card.investigationId, platform }) : false;
  } catch { return false; }
}
