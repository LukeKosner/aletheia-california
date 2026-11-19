import { body, json, requireTeam, sameOrigin } from "../admin/auth";
import { saveFeedback } from "../admin/writer";
import { parseFeedback } from "@/components/feedback/model";
export async function POST(request: Request) {
    if (!await requireTeam(request))
        return json({ error: "Private team sign-in required." }, 401);
    if (!sameOrigin(request))
        return json({ error: "Submit feedback from this site." }, 403);
    let input;
    try {
        input = parseFeedback(await body(request));
    }
    catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid report." }, 400);
    }
    try {
        return json({ ...await saveFeedback(input), saved: true }, 201);
    }
    catch {
        return json({ error: "Feedback could not be saved. Your text is still in this form; please retry later.", saved: false }, 503);
    }
}
