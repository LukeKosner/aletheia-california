import data from "./recorded.json";
import type { Investigation } from "./model";
// Extracted from packages/tools/test/fixtures/calaccess_slice.json, CAL-ACCESS
// filing 3214397, F497P1 line 1. No claim row or verifier run is represented.
export const recordedInvestigation = data as Investigation;
