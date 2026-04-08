import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBinEntry } from "../src/bin-wrapper.js";

describe("bin-wrapper", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("resolves the real dist entry from a symlinked wrapper path", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openrig-bin-wrapper-"));
    const wrapperSource = fileURLToPath(new URL("../src/bin-wrapper.ts", import.meta.url));
    const symlinkPath = path.join(tempDir, "rig");
    fs.symlinkSync(wrapperSource, symlinkPath);

    const entry = resolveBinEntry(symlinkPath, pathToFileURL(wrapperSource).href);
    expect(entry).toBe(path.resolve(path.dirname(wrapperSource), "../dist/index.js"));
  });
});
