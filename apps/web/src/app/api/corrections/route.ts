import { correctionReader, getCorrectionChangelog, getPublicationState } from "@aletheia/tools";
import { adminEmails, body, json, requireTeam, sameOrigin } from "../admin/auth";
import { saveCorrection } from "../admin/writer";
import { logCorrectionNotification } from "../admin/notifications";
import { parseCorrection, UUID } from "@/components/feedback/model";
export async function POST(request: Request) {
    if (!await requireTeam(request))
        return json({ error: "Private team sign-in required." }, 401);
    if (!sameOrigin(request))
        return json({ error: "Submit corrections from this site." }, 403);
    let input;
    try {
        input = parseCorrection(await body(request));
    }
    catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid report." }, 400);
    }
    if (!adminEmails())
        return json({ error: "Correction submission is unavailable until both administrators are configured.", saved: false }, 503);
    try {
        const saved = await saveCorrection(input);
        const notification = logCorrectionNotification(saved.id);
        return json({ ...saved, saved: true, notification, message: "Correction request saved. Both administrators were notified in the private server log; email delivery is not connected." }, 201);
    }
    catch {
        return json({ error: "Correction request could not be saved. Keep your text and retry later.", saved: false }, 503);
    }
}
export async function GET(request: Request) {
    if (!await requireTeam(request))
        return json({ error: "Private team sign-in required." }, 401);
    const cardId = new URL(request.url).searchParams.get("card");
    if (!cardId || !UUID.test(cardId))
        return json({ error: "A saved card identifier is required." }, 400);
    let reader;
    try {
        reader = correctionReader();
        const [publication, changelog] = await Promise.all([getPublicationState(reader, { cardId }), getCorrectionChangelog(reader, cardId)]);
        return json({ publication, changelog });
    }
    catch {
        return json({ error: "Correction history and publication status are unavailable. No publication approval is inferred." }, 503);
    }
    finally {
        await reader?.end();
    }
}
