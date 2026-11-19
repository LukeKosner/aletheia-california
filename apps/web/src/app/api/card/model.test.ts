import { describe, expect, test } from "bun:test";
import fixture from "../../../../../../packages/tools/test/fixtures/calaccess_slice.json";
import { CARD_TYPES, cents, formatMoney, numbers, publicationBlockers, recordedCard, validateCard } from "./model";
import { qrMatrix } from "./qr";

// All filing evidence comes from CAL-ACCESS 3214397, F497P1 line 1.
describe("receipt evidence", () => {
  test("recorded card binds the exact real edge and recomputes cents", () => {
    const card = validateCard(recordedCard());
    const edge = fixture.edges.find((edge) => edge.id === card.lines[0].edgeId)!;
    expect(card.lines[0].amount).toBe(edge.amount);
    expect(numbers(card)[0].cents).toBe(cents(edge.amount));
    expect(formatMoney(numbers(card)[0].cents)).toBe("$3,910,600.00");
    expect(card.published).toBe(false);
    expect(publicationBlockers().length).toBeGreaterThan(0);
  });
  test("duplicates, missing receipts, and individual donor details cannot become totals", () => {
    const card = recordedCard();
    expect(() => numbers({ lines: [...card.lines, ...card.lines] })).toThrow("Duplicate");
    expect(() => numbers({ lines: [] })).toThrow();
    expect(() => numbers({ lines: [{ ...card.lines[0], url: "" }] })).toThrow();
    expect(() => numbers({ lines: [{ ...card.lines[0], donorKind: "person" }] })).toThrow("aggregation");
    expect(() => cents("NaN")).toThrow();
  });
  test("all four layouts share the same bounded evidence contract", () => {
    const card = recordedCard();
    for (const type of Object.keys(CARD_TYPES) as (keyof typeof CARD_TYPES)[]) expect(validateCard({ ...card, type }).type).toBe(type);
    expect(() => validateCard({ ...card, finding: card.finding.repeat(3) })).toThrow();
  });
  test("QR is a real bounded module matrix", () => {
    const url = `http://localhost:3001/r/${recordedCard().id}`;
    const matrix = qrMatrix(url);
    expect(matrix.length).toBe(37);
    expect(matrix.every((row) => row.length === 37)).toBe(true);
    expect(() => qrMatrix(url.repeat(3))).toThrow();
  });
});
