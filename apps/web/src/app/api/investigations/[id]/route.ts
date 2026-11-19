import { authorize } from "../security";
import { loadResult, publicError } from "../service";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await authorize(request);
    const { id } = await context.params;
    return Response.json(await loadResult(id), { headers: { "cache-control": "no-store" } });
  } catch (error) { return publicError(error); }
}
