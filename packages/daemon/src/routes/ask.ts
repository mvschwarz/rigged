import { Hono } from "hono";
import type { AskService } from "../domain/ask-service.js";

export const askRoutes = new Hono();

askRoutes.post("/", async (c) => {
  const askService = c.get("askService" as never) as AskService;

  const body = await c.req.json<{ rig?: string; question?: string }>();

  if (!body.rig || !body.question) {
    return c.json({ error: "Missing required fields: rig, question" }, 400);
  }

  const result = await askService.ask(body.rig, body.question);
  return c.json(result);
});
