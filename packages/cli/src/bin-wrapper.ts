#!/usr/bin/env node

import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function resolveBinEntry(invokedPath = process.argv[1], moduleUrl = import.meta.url): string {
  const wrapperPath = invokedPath ? realpathSync(invokedPath) : realpathSync(fileURLToPath(moduleUrl));
  const packageRoot = path.resolve(path.dirname(wrapperPath), "..");
  return path.join(packageRoot, "dist", "index.js");
}

export function isDirectRun(argv1 = process.argv[1], moduleUrl = import.meta.url): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

export async function run(argv = process.argv): Promise<void> {
  const normalizedArgv = [...argv];
  if (normalizedArgv[1]) {
    normalizedArgv[1] = realpathSync(normalizedArgv[1]);
  }

  const entryUrl = pathToFileURL(resolveBinEntry(normalizedArgv[1], import.meta.url)).href;
  const mod = await import(entryUrl) as { createProgram: () => { parseAsync: (argv: string[]) => Promise<void> } };
  await mod.createProgram().parseAsync(normalizedArgv);
}

if (isDirectRun()) {
  await run(process.argv);
}
