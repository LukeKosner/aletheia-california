import { currentAdminIdentity, isAdmin } from "@/app/api/admin/auth";
import { localDevSignInSkipped } from "@/app/sign-in/session";
import { isOwner } from "./access";
import { InterviewError } from "./store";

/** A verified administrator, or anyone in local development (where sign-in is skipped everywhere). */
export async function isStaff(): Promise<boolean> {
  if (localDevSignInSkipped()) return true;
  return isAdmin(await currentAdminIdentity().catch(() => null));
}

/** Money actions (payouts, top-ups, research runs) are staff-only, even with the interview preview on. */
export async function requireStaff(): Promise<void> {
  if (!await isStaff()) throw new InterviewError("forbidden", "Administrator access required.", 403);
}

/** A study's results belong to the browser that created it, plus staff. Voters only ever get the share link. */
export async function canSeeStudy(studyId: string): Promise<boolean> {
  return await isOwner(studyId) || await isStaff();
}
