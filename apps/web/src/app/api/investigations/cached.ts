import { getFiling, sharedDb } from "@aletheia/tools";
import { cacheLife } from "next/cache";
import { configuration, getTask, usable, type RuntimeResponse } from "./runtime";
import { InvestigationError } from "./validation";
import type { InvestigationInput } from "./contract";

/**
 * A finished agent run never changes, so reopening a saved answer reuses it instead of downloading it again from
 * HarnessRouter (about 3 seconds). A run that is not finished throws, and thrown results are never cached.
 * Unpublishing is still checked on every request, outside this cache.
 */
export async function finishedTask(taskId: string, type: InvestigationInput["type"]): Promise<RuntimeResponse> {
  "use cache";
  cacheLife("days");
  const response = await getTask(taskId, configuration(type));
  if (!usable(response)) throw new InvestigationError("not_finished", "The run is not finished.", 409);
  return response;
}

/** A public filing is a fixed record; the answer and the evidence route read the same ones, so share one cached copy. */
export async function cachedFiling(id: string): ReturnType<typeof getFiling> {
  "use cache";
  cacheLife("days");
  return getFiling(sharedDb(), id);
}
