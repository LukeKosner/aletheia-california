import { correctionReader, listCorrections } from "@aletheia/tools";
import { adminForRequest, body, json, sameOrigin } from "../auth";
import { resolveCorrection } from "../writer";
import { parseResolution } from "@/components/feedback/model";
export async function GET(request: Request) {
    if (!await adminForRequest(request))
        return json({ error: "A verified administrator session is required." }, 403);
    let reader;
    try {
        reader = correctionReader();
        return json({ corrections: await listCorrections(reader) });
    }
    catch {
        return json({ error: "The correction queue is unavailable." }, 503);
    }
    finally {
        await reader?.end();
    }
}
export async function POST(request: Request) {
    const identity = await adminForRequest(request);
    if (!identity)
        return json({ error: "A verified administrator session is required." }, 403);
    if (!sameOrigin(request))
        return json({ error: "Review corrections from this site." }, 403);
    let input;
    try {
        input = parseResolution(await body(request));
    }
    catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid resolution." }, 400);
    }
    try {
        return json(await resolveCorrection(input, identity));
    }
    catch {
        return json({ error: "The correction could not be resolved. Check that it is open and that every supporting evidence identifier exists. No success is claimed." }, 503);
    }
}
