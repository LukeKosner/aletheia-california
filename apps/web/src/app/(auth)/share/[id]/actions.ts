"use server";
import { redirect } from "next/navigation";
import { resolvePublishedReceipt } from "@/lib/published-receipt";
import { currentVerifiedIdentity } from "@/lib/auth-session";
import { shareIntent, shareText, SHARE_PLATFORMS, type SharePlatform } from "@/lib/share";
import { recordShareClicked } from "@/lib/server-events";

export async function openShare(id: string, platform: SharePlatform) {
  const identity = await currentVerifiedIdentity();
  if (!identity) redirect("/sign-in");
  if (!SHARE_PLATFORMS.includes(platform)) return;
  const card = await resolvePublishedReceipt(id).catch(() => null);
  if (!card) return;
  const receipt = card.shortlink;
  const text = shareText(card.finding, receipt);
  await recordShareClicked(card.id, platform);
  redirect(shareIntent(platform, text, receipt));
}
