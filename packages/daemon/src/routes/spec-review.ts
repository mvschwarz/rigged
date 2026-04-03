import { Hono } from "hono";
import { SpecReviewService, SpecReviewError, type SourceState } from "../domain/spec-review-service.js";

export function specReviewRoutes(): Hono {
  const router = new Hono();

  router.post("/rig", async (c) => {
    const svc = c.get("specReviewService" as never) as SpecReviewService;
    const body = await c.req.json<{ yaml: string; sourceState?: SourceState }>();

    if (!body.yaml) {
      return c.json({ error: "Missing required field: yaml" }, 400);
    }

    try {
      const review = svc.reviewRigSpec(body.yaml, body.sourceState ?? "draft");
      return c.json(review);
    } catch (err) {
      if (err instanceof SpecReviewError) {
        return c.json({ errors: err.errors }, 400);
      }
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  router.post("/agent", async (c) => {
    const svc = c.get("specReviewService" as never) as SpecReviewService;
    const body = await c.req.json<{ yaml: string; sourceState?: SourceState }>();

    if (!body.yaml) {
      return c.json({ error: "Missing required field: yaml" }, 400);
    }

    try {
      const review = svc.reviewAgentSpec(body.yaml, body.sourceState ?? "draft");
      return c.json(review);
    } catch (err) {
      if (err instanceof SpecReviewError) {
        return c.json({ errors: err.errors }, 400);
      }
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  return router;
}
