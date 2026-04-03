import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { SpecReviewService } from "../src/domain/spec-review-service.js";
import { specReviewRoutes } from "../src/routes/spec-review.js";

function createApp(): Hono {
  const app = new Hono();
  const svc = new SpecReviewService();
  app.use("*", async (c, next) => {
    c.set("specReviewService" as never, svc);
    await next();
  });
  app.route("/api/specs/review", specReviewRoutes());
  return app;
}

const VALID_RIG_YAML = `
version: "0.2"
name: test-rig
pods:
  - id: dev
    label: Dev
    members:
      - id: impl
        agent_ref: "local:agents/impl"
        runtime: claude-code
        profile: default
        cwd: /tmp
    edges: []
edges: []
`;

const VALID_AGENT_YAML = `
name: test-agent
version: "1.0"
defaults:
  runtime: claude-code
profiles:
  default:
    uses: []
resources:
  skills: []
startup:
  files: []
  actions: []
`;

describe("spec review routes", () => {
  it("POST /rig returns RigSpecReview for valid YAML", async () => {
    const app = createApp();
    const res = await app.request("/api/specs/review/rig", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml: VALID_RIG_YAML }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("rig");
    expect(body.sourceState).toBe("draft");
    expect(body.name).toBe("test-rig");
    expect(body.format).toBe("pod_aware");
    expect(body.graph).toBeDefined();
    expect(body.graph.nodes.length).toBe(1);
  });

  it("POST /agent returns AgentSpecReview for valid YAML", async () => {
    const app = createApp();
    const res = await app.request("/api/specs/review/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml: VALID_AGENT_YAML }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("agent");
    expect(body.sourceState).toBe("draft");
    expect(body.name).toBe("test-agent");
  });

  it("POST /rig with invalid YAML returns 400", async () => {
    const app = createApp();
    const res = await app.request("/api/specs/review/rig", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml: "name: test\n" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it("POST /rig with malformed YAML returns 400, not 500", async () => {
    const app = createApp();
    const res = await app.request("/api/specs/review/rig", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml: "name: [bad\nversion:" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors[0]).toContain("parse error");
  });

  it("POST /agent with malformed YAML returns 400, not 500", async () => {
    const app = createApp();
    const res = await app.request("/api/specs/review/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml: "name: [bad" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors[0]).toContain("parse error");
  });
});
