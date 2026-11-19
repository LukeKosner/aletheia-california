/**
 * Address → California State Assembly and State Senate districts via the free
 * US Census Geocoder. Layers 56 and 58 of the Current_Current vintage are the
 * "State Legislative Districts - Upper" (Senate) and "- Lower" (Assembly) layers
 * (ids from the TIGERweb tigerWMS_Current MapServer layer list).
 * The address is never logged or stored.
 */
export type Districts = { assembly: number; senate: number; matchedAddress: string };

const GEOCODER = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const LAYERS = "56,58";
const CALIFORNIA = "06";

type Geography = { STATE?: unknown; SLDU?: unknown; SLDL?: unknown; BASENAME?: unknown };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Finds the first geography in a layer whose name ends with the given suffix (the year prefix changes). */
function layer(geographies: Record<string, unknown>, suffix: string): Geography | null {
  for (const [name, value] of Object.entries(geographies)) {
    if (name.endsWith(suffix) && Array.isArray(value)) return record(value[0]) as Geography | null;
  }
  return null;
}

function districtNumber(geo: Geography | null, field: "SLDU" | "SLDL"): number | null {
  if (!geo || geo.STATE !== CALIFORNIA) return null;
  const raw = typeof geo[field] === "string" ? geo[field] : geo.BASENAME;
  if (typeof raw !== "string" || !/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

/** Pure: reads a Census geocoder JSON response. Null unless the match is in California with both districts. */
export function parseDistricts(json: unknown): Districts | null {
  const matches = record(record(json)?.result)?.addressMatches;
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const match = record(matches[0]);
  const geographies = record(match?.geographies);
  if (!match || !geographies) return null;
  const senate = districtNumber(layer(geographies, "State Legislative Districts - Upper"), "SLDU");
  const assembly = districtNumber(layer(geographies, "State Legislative Districts - Lower"), "SLDL");
  if (senate === null || assembly === null) return null;
  const matchedAddress = typeof match.matchedAddress === "string" ? match.matchedAddress : "";
  return { assembly, senate, matchedAddress };
}

export class DistrictError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 502) {
    super(message);
    this.name = "DistrictError";
  }
}

/** Server-side lookup. Throws DistrictError with a short user-facing message. */
export async function lookupDistricts(address: string): Promise<Districts> {
  const value = typeof address === "string" ? address.trim().replace(/\s+/g, " ") : "";
  if (value.length < 5 || value.length > 200) throw new DistrictError("Enter a full street address.", 400);
  const url = new URL(GEOCODER);
  url.search = new URLSearchParams({
    address: value,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    layers: LAYERS,
    format: "json",
  }).toString();
  let json: unknown;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("bad status");
    json = await response.json();
  } catch {
    throw new DistrictError("The address service is unavailable. Try again later.", 502);
  }
  const districts = parseDistricts(json);
  if (!districts) throw new DistrictError("No California address match found.", 404);
  return districts;
}
