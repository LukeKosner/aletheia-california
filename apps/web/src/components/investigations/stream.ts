/** Accept only the server's UUID, never a URL supplied in a response header. */
export function savedInvestigationPath(response: Response): string | null {
  const id = response.headers.get("x-aletheia-investigation-id");
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)
    ? `/i/${id.toLowerCase()}` : null;
}

/** Parse named SSE frames even when UTF-8 or frame boundaries span chunks. */
export async function consumeStream(response: Response, signal: AbortSignal, receive: (name: string, data: unknown) => void) {
  if (!response.body) throw new Error("The response did not include an investigation stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const parse = (frame: string) => {
    let name = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length) receive(name, JSON.parse(data.join("\n")));
  };
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      // SSE permits CRLF; keep trailing CR until the following chunk arrives.
      pending = pending.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = pending.indexOf("\n\n")) >= 0) { parse(pending.slice(0, boundary)); pending = pending.slice(boundary + 2); }
      if (done) { if (pending.trim()) parse(pending); break; }
    }
  } finally { reader.releaseLock(); }
}

