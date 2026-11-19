import { expect, mock, test } from "bun:test";
// Next's server-only compile marker has no runtime behavior in these offline tests.
mock.module("server-only", () => ({}));
const { POST: resolve, GET: queue } = await import("./corrections/route");
const { POST: unpublish } = await import("./publication/route");
const { POST: feedback } = await import("../feedback/route");
const { POST: correction } = await import("../corrections/route");
// These calls fail before any store access; tests never connect to a database.
test("all write routes and private queue reject requests without a session", async () => {
    for (const handler of [resolve, unpublish, feedback, correction]) {
        const response = await handler(new Request("https://localhost/api", { method: "POST" }));
        expect([401, 403]).toContain(response.status);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect((await queue(new Request("https://localhost/api/admin/corrections"))).status).toBe(403);
});
