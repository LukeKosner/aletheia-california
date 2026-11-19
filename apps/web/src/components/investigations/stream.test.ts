import { describe, expect, test } from "bun:test";
import { consumeStream, savedInvestigationPath } from "./stream";
import { recordedInvestigation } from "./recorded";
import fixture from "../../../../../packages/tools/test/fixtures/calaccess_slice.json";

describe("recorded evidence and streamed transport", () => {
  test("keeps a saved job link before any response body is consumed", () => {
    // Real fixture UUID used only as a transport identifier, not a claim that
    // this public filing is an already persisted investigation.
    const id = fixture.filings[0].id;
    const response = new Response("event: progress\ndata: {}\n\n", { headers: { "x-aletheia-investigation-id": id } });
    expect(savedInvestigationPath(response)).toBe(`/i/${id}`);
    expect(response.bodyUsed).toBe(false);
  });
  test("refuses missing and non-UUID recovery headers", () => {
    expect(savedInvestigationPath(new Response())).toBeNull();
    expect(savedInvestigationPath(new Response(null, { headers: { "x-aletheia-investigation-id": "/ask" } }))).toBeNull();
  });
  test("recorded sentence and map preserve the actual filing and amount", () => {
    const edge = fixture.edges.find((item) => item.id === recordedInvestigation.graph?.edges[0].id)!;
    const filing = fixture.filings.find((item) => item.filing_id === edge.filing_id)!;
    expect(recordedInvestigation.sources[0].url).toBe(filing.url);
    expect(recordedInvestigation.graph?.edges[0].amount).toBe(edge.amount);
    expect(recordedInvestigation.answer.sections[0].sentences[0].claim_id).toBeNull();
    expect(recordedInvestigation.verification?.status).toBe("not_run");
  });
  test("handles byte boundaries and CRLF named frames", async () => {
    const encoded = new TextEncoder().encode(`event: result\r\ndata: ${JSON.stringify(recordedInvestigation)}\r\n\r\n`);
    const response = new Response(new ReadableStream({ start(controller) { for (const byte of encoded) controller.enqueue(new Uint8Array([byte])); controller.close(); } }));
    const received: unknown[] = [];
    await consumeStream(response, new AbortController().signal, (name, data) => received.push({ name, data }));
    expect(received).toEqual([{ name: "result", data: recordedInvestigation }]);
  });
  test("rejects malformed transport instead of rendering a partial answer", async () => {
    await expect(consumeStream(new Response('event: result\ndata: {\n\n'), new AbortController().signal, () => {})).rejects.toThrow();
  });
});
