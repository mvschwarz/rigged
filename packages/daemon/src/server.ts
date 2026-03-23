import { Hono } from "hono";

export const app = new Hono();

app.get("/healthz", (c) => {
  return c.json({ status: "ok" });
});
