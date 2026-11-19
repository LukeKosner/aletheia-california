import { describe, expect, test } from "bun:test";
import { parseDistricts } from "./district";

// Trimmed copy of the real US Census Geocoder response for the California State Capitol
// (a public building, not a personal address). Fetched 2026-11-17 from:
// https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=1315+10th+St%2C+Sacramento%2C+CA+95814&benchmark=Public_AR_Current&vintage=Current_Current&format=json&layers=56,58
// Only fields parseDistricts reads (plus NAME/GEOID for context) are kept.
const capitol = {
  result: {
    addressMatches: [
      {
        matchedAddress: "1315 10TH ST, SACRAMENTO, CA, 95814",
        geographies: {
          "2026 State Legislative Districts - Upper": [
            { GEOID: "06008", STATE: "06", BASENAME: "8", SLDU: "008", NAME: "State Senate District 8" },
          ],
          "2026 State Legislative Districts - Lower": [
            { GEOID: "06006", STATE: "06", BASENAME: "6", SLDL: "006", NAME: "Assembly District 6" },
          ],
        },
      },
    ],
  },
};

describe("parseDistricts", () => {
  test("reads Assembly and Senate districts from the Capitol response", () => {
    expect(parseDistricts(capitol)).toEqual({ assembly: 6, senate: 8, matchedAddress: "1315 10TH ST, SACRAMENTO, CA, 95814" });
  });

  test("returns null when no address matched", () => {
    expect(parseDistricts({ result: { addressMatches: [] } })).toBeNull();
    expect(parseDistricts(null)).toBeNull();
  });

  test("returns null outside California", () => {
    // Same real response with only the STATE field changed from "06" to "32" (Nevada FIPS).
    const geos = capitol.result.addressMatches[0].geographies;
    const nonCa = {
      result: {
        addressMatches: [{
          ...capitol.result.addressMatches[0],
          geographies: {
            "2026 State Legislative Districts - Upper": [{ ...geos["2026 State Legislative Districts - Upper"][0], STATE: "32" }],
            "2026 State Legislative Districts - Lower": [{ ...geos["2026 State Legislative Districts - Lower"][0], STATE: "32" }],
          },
        }],
      },
    };
    expect(parseDistricts(nonCa)).toBeNull();
  });

  test("returns null when a district layer is missing", () => {
    const geos = capitol.result.addressMatches[0].geographies;
    const upperOnly = { result: { addressMatches: [{ ...capitol.result.addressMatches[0], geographies: { "2026 State Legislative Districts - Upper": geos["2026 State Legislative Districts - Upper"] } }] } };
    expect(parseDistricts(upperOnly)).toBeNull();
  });
});
