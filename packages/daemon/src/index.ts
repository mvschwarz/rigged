import { serve } from "@hono/node-server";
import { app } from "./server.js";

export function startServer(port?: number) {
  const p = port ?? parseInt(process.env["RIGGED_PORT"] ?? "7433", 10);
  return serve({ fetch: app.fetch, port: p }, (info) => {
    console.log(`rigged daemon listening on http://localhost:${info.port}`);
  });
}

// Only start the server when this file is executed directly (not imported).
const isDirectRun =
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  startServer();
}
