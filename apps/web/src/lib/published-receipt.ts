import "server-only";
/** Integration contract for P13 approval + durable alias storage and the P15
 * publication/tombstone gate. Never synthesize a /c/{id} URL or infer approval
 * from card.published. Missing resolver/storage leaves sharing and view events
 * closed. P13 currently provides only an unverified recorded preview. */
export type PublishedReceipt = { id: string; investigationId: string; finding: string; shortlink: string };
export async function resolvePublishedReceipt(cardId: string): Promise<PublishedReceipt | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardId)) return null;
  // Connect the trusted read-only publication/approval/alias tool here when its
  // storage contract exists; this stub grants no sharing or publication access.
  return null;
}
