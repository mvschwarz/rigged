import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { Command } from "commander";
import { DaemonClient } from "../src/client.js";
import { STATE_FILE, type LifecycleDeps, type DaemonState } from "../src/daemon-lifecycle.js";
import { createProgram } from "../src/index.js";
import { unclaimCommand } from "../src/commands/unclaim.js";
import { removeCommand } from "../src/commands/remove.js";
import { shrinkCommand } from "../src/commands/shrink.js";
import type { StatusDeps } from "../src/commands/status.js";

function mockLifecycleDeps(): LifecycleDeps {
  return {
    spawn: vi.fn(() => ({ pid: 1, unref: vi.fn() }) as never),
    fetch: vi.fn(async () => ({ ok: true })),
    kill: vi.fn(() => true),
    readFile: vi.fn(() => null),
    writeFile: vi.fn(),
    removeFile: vi.fn(),
    exists: vi.fn(() => false),
    mkdirp: vi.fn(),
    openForAppend: vi.fn(() => 3),
    isProcessAlive: vi.fn(() => true),
  };
}

function captureLogs(fn: () => Promise<void>): Promise<{ logs: string[]; exitCode: number | undefined }> {
  return new Promise(async (resolve) => {
    const logs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    const origExitCode = process.exitCode;
    process.exitCode = undefined;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    console.error = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      await fn();
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    const exitCode = process.exitCode;
    process.exitCode = origExitCode;
    resolve({ logs, exitCode });
  });
}

describe("Lifecycle CLI commands", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/sessions/session-123/unclaim") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          rigId: "rig-1",
          nodeId: "node-1",
          logicalId: "external.helper",
          sessionId: "session-123",
          sessionName: "manual-helper",
        }));
        return;
      }

      if (req.method === "DELETE" && req.url === "/api/rigs/rig-1/nodes/dev.impl") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          rigId: "rig-1",
          nodeId: "node-1",
          logicalId: "dev.impl",
          sessionsKilled: 1,
        }));
        return;
      }

      if (req.method === "DELETE" && req.url === "/api/rigs/rig-1/pods/dev") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          rigId: "rig-1",
          podId: "pod-1",
          namespace: "dev",
          removedLogicalIds: ["dev.impl", "dev.qa"],
          sessionsKilled: 2,
        }));
        return;
      }

      if (req.method === "POST" && req.url === "/api/sessions/missing/unclaim") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Claimed session 'missing' not found." }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => { server.listen(0, resolve); });
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => {
    server.close();
  });

  function runningDeps(): StatusDeps {
    return {
      lifecycleDeps: {
        ...mockLifecycleDeps(),
        exists: vi.fn((p: string) => p === STATE_FILE),
        readFile: vi.fn((p: string) => {
          if (p === STATE_FILE) {
            return JSON.stringify({ pid: 123, port, db: "test.sqlite", startedAt: "2026-04-07T00:00:00Z" } as DaemonState);
          }
          return null;
        }),
        fetch: vi.fn(async () => ({ ok: true })),
      },
      clientFactory: (url) => new DaemonClient(url),
    };
  }

  it("unclaim prints released session details", async () => {
    const program = new Command();
    program.exitOverride();
    program.addCommand(unclaimCommand(runningDeps()));

    const { logs, exitCode } = await captureLogs(async () => {
      await program.parseAsync(["node", "rig", "unclaim", "session-123"]);
    });

    expect(exitCode).toBeUndefined();
    expect(logs.join("\n")).toContain("Released claimed session manual-helper");
    expect(logs.join("\n")).toContain("external.helper");
  });

  it("remove prints removed node details", async () => {
    const program = new Command();
    program.exitOverride();
    program.addCommand(removeCommand(runningDeps()));

    const { logs, exitCode } = await captureLogs(async () => {
      await program.parseAsync(["node", "rig", "remove", "rig-1", "dev.impl"]);
    });

    expect(exitCode).toBeUndefined();
    expect(logs.join("\n")).toContain("Removed node dev.impl from rig rig-1");
  });

  it("shrink prints removed pod summary", async () => {
    const program = new Command();
    program.exitOverride();
    program.addCommand(shrinkCommand(runningDeps()));

    const { logs, exitCode } = await captureLogs(async () => {
      await program.parseAsync(["node", "rig", "shrink", "rig-1", "dev"]);
    });

    expect(exitCode).toBeUndefined();
    expect(logs.join("\n")).toContain("Removed pod dev from rig rig-1");
    expect(logs.join("\n")).toContain("2 node(s)");
  });

  it("--json prints raw unclaim payload", async () => {
    const program = new Command();
    program.exitOverride();
    program.addCommand(unclaimCommand(runningDeps()));

    const { logs, exitCode } = await captureLogs(async () => {
      await program.parseAsync(["node", "rig", "unclaim", "session-123", "--json"]);
    });

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.ok).toBe(true);
    expect(parsed.sessionId).toBe("session-123");
  });

  it("errors exit non-zero with server message", async () => {
    const program = new Command();
    program.exitOverride();
    program.addCommand(unclaimCommand(runningDeps()));

    const { logs, exitCode } = await captureLogs(async () => {
      await program.parseAsync(["node", "rig", "unclaim", "missing"]);
    });

    expect(exitCode).toBe(1);
    expect(logs.join("\n")).toContain("not found");
  });

  it("createProgram wires unclaim, remove, and shrink", async () => {
    const program = createProgram();
    expect(program.commands.find((c) => c.name() === "unclaim")).toBeDefined();
    expect(program.commands.find((c) => c.name() === "remove")).toBeDefined();
    expect(program.commands.find((c) => c.name() === "shrink")).toBeDefined();
  });
});
