import { correctionReader, getReportAvailability } from "@aletheia/tools";
import { json, requireTeam } from "../../admin/auth";
import { UUID } from "@/components/feedback/model";
import { localDevSignInSkipped } from "@/app/sign-in/session";
export async function GET(request: Request) {
    // Local dev skips team sign-in everywhere else (proxy, investigations, cards); match it so finished reports show.
    if (!localDevSignInSkipped() && !await requireTeam(request))
        return json({ error: "Private team sign-in required." }, 401);
    const investigationId = new URL(request.url).searchParams.get("investigation");
    if (!investigationId || !UUID.test(investigationId))
        return json({ state: "unavailable" }, 400);
    let reader;
    try {
        reader = correctionReader();
        return json({ state: await getReportAvailability(reader, investigationId) });
    }
    catch {
        return json({ state: "unavailable" }, 503);
    }
    finally {
        await reader?.end();
    }
}
