import { after } from "next/server";
import { authorize } from "./security";
import { consume, prepare, publicError } from "./service";
import { InvestigationError, parseInput } from "./validation";
import type { InvestigationEvent } from "./contract";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    await authorize(request);
    if (Number(request.headers.get("content-length")) > 8192) throw new InvestigationError("too_large", "The request is too large.", 413);
    // Streaming input limit also handles chunked requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new InvestigationError("invalid_data", "A question is required.");
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 8192) { await reader.cancel(); throw new InvestigationError("too_large", "The request is too large.", 413); }
      chunks.push(value);
    }
    const body = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    let json: unknown;
    try { json = JSON.parse(new TextDecoder().decode(body)); } catch { throw new InvestigationError("invalid_data", "The request must be JSON."); }
    const input = parseInput(json), { id, config } = await prepare(input);
    const encoder = new TextEncoder(); let connected = true;
    let run: Promise<void> = Promise.resolve();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (event: InvestigationEvent) => {
          if (connected) { try { controller.enqueue(encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)); } catch { connected = false; } }
        };
        run = consume(input, id, config, emit).finally(() => { if (connected) { connected = false; controller.close(); } });
      },
      cancel() { connected = false; },
    });
    // Continue consuming and saving after a tab closes, within the host duration.
    after(() => run);
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no", "x-aletheia-investigation-id": id } });
  } catch (error) { return publicError(error); }
}
