import { DistrictError, lookupDistricts } from "@/lib/district";

const headers = { "Cache-Control": "private, no-store" };

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}

/** POST {address} so addresses never appear in URLs or access logs. */
export async function POST(request: Request) {
  let address: unknown;
  try {
    address = (await request.json() as { address?: unknown } | null)?.address;
  } catch {
    return reply({ error: "Enter a full street address." }, 400);
  }
  if (typeof address !== "string") return reply({ error: "Enter a full street address." }, 400);
  try {
    return reply(await lookupDistricts(address));
  } catch (error) {
    if (error instanceof DistrictError) return reply({ error: error.message }, error.status);
    return reply({ error: "The address service is unavailable. Try again later." }, 502);
  }
}
