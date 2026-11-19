import { expect, test } from "bun:test";
import { correctionReader, publicResolution } from "../src/corrections";
test("correction reader cannot fall back to an owner or agent connection", () => {
    expect(() => correctionReader({})).toThrow();
    expect(() => correctionReader({ DATABASE_URL: "postgres://postgres@localhost/database" })).toThrow();
    expect(() => correctionReader({ CORRECTIONS_READER_DATABASE_URL: "postgres://claim_writer@localhost/database" })).toThrow();
});
test("legacy or malformed resolution content is excluded from published changelog", () => {
    expect(publicResolution(null)).toBeNull();
    expect(publicResolution("private report text")).toBeNull();
    expect(publicResolution(JSON.stringify({ request: "private report text" }))).toBeNull();
});
