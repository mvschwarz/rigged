import { Hono } from "hono";
import type { PsProjectionService } from "../domain/ps-projection.js";

export const psRoutes = new Hono();

psRoutes.get("/", (c) => {
  const psService = c.get("psProjectionService" as never) as PsProjectionService;
  return c.json(psService.getEntries());
});
