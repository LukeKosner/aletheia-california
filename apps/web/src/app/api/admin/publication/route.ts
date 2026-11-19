import { adminForRequest, body, json, sameOrigin } from "../auth";
import { unpublish } from "../writer";
import { parseUnpublish } from "@/components/feedback/model";
export async function POST(request: Request) {
    const identity = await adminForRequest(request);
    if (!identity)
        return json({ error: "A verified administrator session is required." }, 403);
    if (!sameOrigin(request))
        return json({ error: "Manage publication from this site." }, 403);
    let input;
    try {
        input = parseUnpublish(await body(request));
    }
    catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid request." }, 400);
    }
    try {
        return json(await unpublish(input, identity));
    }
    catch {
        return json({ error: "The report could not be unpublished. Publication state has not been confirmed." }, 503);
    }
}
