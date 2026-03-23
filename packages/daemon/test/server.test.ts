import { describe, it, expect } from "vitest";
import { app } from "../src/server.js";

describe("Hono server", () => {
  it("GET /healthz returns 200 with status ok", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("GET /unknown returns 404", async () => {
    const res = await app.request("/unknown");
    expect(res.status).toBe(404);
  });
});
