import { Command } from "commander";
import { DaemonClient } from "../client.js";
import { getDaemonStatus, getDaemonUrl } from "../daemon-lifecycle.js";
import { realDeps } from "./daemon.js";
import type { StatusDeps } from "./status.js";

export function bindCommand(depsOverride?: StatusDeps): Command {
  const cmd = new Command("bind").description("Bind a discovered session to an existing logical node");
  const getDeps = () => depsOverride ?? { lifecycleDeps: realDeps(), clientFactory: (url: string) => new DaemonClient(url) };

  async function getClient(deps: StatusDeps): Promise<DaemonClient | null> {
    const status = await getDaemonStatus(deps.lifecycleDeps);
    if (status.state !== "running" || status.healthy === false) {
      console.error("Daemon not running");
      return null;
    }
    return deps.clientFactory(getDaemonUrl(status));
  }

  cmd
    .argument("<discoveredId>", "ID of the discovered session")
    .requiredOption("--rig <rigId>", "Target rig ID")
    .requiredOption("--node <logicalId>", "Existing logical node ID in the target rig")
    .action(async (discoveredId: string, opts: { rig: string; node: string }) => {
      const deps = getDeps();
      const client = await getClient(deps);
      if (!client) { process.exitCode = 1; return; }

      const res = await client.post<Record<string, unknown>>(`/api/discovery/${encodeURIComponent(discoveredId)}/bind`, {
        rigId: opts.rig,
        logicalId: opts.node,
      });

      if (res.status >= 400) {
        console.error(res.data["error"] ?? `Bind failed (HTTP ${res.status})`);
        process.exitCode = 1;
        return;
      }

      console.log(`Bound discovery ${discoveredId} to node ${opts.node} in rig ${opts.rig}`);
    });

  return cmd;
}
