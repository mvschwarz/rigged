#!/usr/bin/env node
import { Command } from "commander";
import { daemonCommand } from "./commands/daemon.js";
import { statusCommand, type StatusDeps } from "./commands/status.js";
import type { LifecycleDeps } from "./daemon-lifecycle.js";

export interface ProgramDeps {
  daemonDeps?: LifecycleDeps;
  statusDeps?: StatusDeps;
}

export function createProgram(depsOverride?: ProgramDeps): Command {
  const program = new Command();

  program
    .name("rigged")
    .description("CLI for the Rigged local control plane")
    .version("0.1.0");

  program.addCommand(daemonCommand(depsOverride?.daemonDeps));
  program.addCommand(statusCommand(depsOverride?.statusDeps));

  return program;
}

// Only parse when executed directly (not imported for testing)
const isDirectRun =
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  createProgram().parse();
}
