import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TranscriptStore } from "../src/domain/transcript-store.js";

describe("TranscriptStore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "transcript-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("getTranscriptPath", () => {
    it("returns deterministic {root}/{rigName}/{sessionName}.log", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      const path = store.getTranscriptPath("my-rig", "dev-impl@my-rig");
      expect(path).toBe(join(tmpDir, "my-rig", "dev-impl@my-rig.log"));
    });
  });

  describe("ensureTranscriptDir", () => {
    it("creates nested directory structure and returns true", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      const result = store.ensureTranscriptDir("my-rig");
      expect(result).toBe(true);
      expect(existsSync(join(tmpDir, "my-rig"))).toBe(true);
    });

    it("returns false on permission error without throwing", () => {
      const readonlyDir = join(tmpDir, "readonly");
      mkdirSync(readonlyDir);
      chmodSync(readonlyDir, 0o444);
      const store = new TranscriptStore({ transcriptsRoot: join(readonlyDir, "nested") });
      const result = store.ensureTranscriptDir("my-rig");
      expect(result).toBe(false);
      // Restore permissions for cleanup
      chmodSync(readonlyDir, 0o755);
    });
  });

  describe("writeBoundaryMarker", () => {
    it("appends marker with ISO timestamp to file and returns true", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      store.ensureTranscriptDir("my-rig");
      // Create an existing transcript file with prior content
      const filePath = store.getTranscriptPath("my-rig", "dev-impl@my-rig");
      writeFileSync(filePath, "prior content\n");

      const result = store.writeBoundaryMarker("my-rig", "dev-impl@my-rig", "restored from snapshot abc123");
      expect(result).toBe(true);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("prior content\n");
      expect(content).toMatch(/--- SESSION BOUNDARY: restored from snapshot abc123 at \d{4}-\d{2}-\d{2}T/);
      expect(content).toMatch(/---\n$/);
    });

    it("returns false on filesystem error without throwing", () => {
      const store = new TranscriptStore({ transcriptsRoot: join(tmpDir, "nonexistent", "deep") });
      // Directory doesn't exist, write will fail
      const result = store.writeBoundaryMarker("my-rig", "dev-impl@my-rig", "test");
      expect(result).toBe(false);
    });
  });

  describe("stripAnsi", () => {
    it("removes ANSI escape sequences from spike doc examples", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      const raw = "\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m  \x1b[0m\x1b[27m\x1b[24m\x1b[Jmschwarz@mike-air /tmp % \x1b[K\x1b[?2004hecho 'test'\x1b[?2004l";
      const stripped = store.stripAnsi(raw);
      expect(stripped).not.toContain("\x1b[");
      expect(stripped).toContain("mschwarz@mike-air /tmp %");
      expect(stripped).toContain("echo 'test'");
    });

    it("preserves readability for real TUI cursor-motion output", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      const raw = "\x1b[38;5;231m⏺\x1b[1C\x1b[39mTRANSCRIPT PROBE\x1b[1CACK\x1b[1C2026-03-31\r\x1b[2B\x1b[38;5;174m✳\x1b[39m \x1b[38;5;174mSchlepping… \x1b[39m                                                                   \r\x1b[1B   \r\x1b[2B\x1b[38;5;246m❯\u00a0\x1b[39m\x1b[7m \x1b[27m               \r\n\x1b]0;✳ Restore protocol start and read inventory\u0007\r\n\x1b[2C\x1b[38;5;246mesc\x1b[1Cto\x1b[1Cinterrupt\x1b[39m";
      const stripped = store.stripAnsi(raw);
      expect(stripped).toContain("TRANSCRIPT PROBE ACK 2026-03-31");
      expect(stripped).toContain("esc to interrupt");
      expect(stripped).not.toContain("\x1b");
      expect(stripped).not.toContain("]0;");
    });

    it("removes shell redraw noise from real transcript capture", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      const raw = "printf 'TRACK_A_SMOKE_LINE\\nPNS-T06 marker\\n'\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                               \r  \r\r\x1b[0m\x1b[27m\x1b[24m\x1b[Jmschwarz@mike-air rigged % \x1b[K\x1b[?2004hp\bprintf 'TRACK_A_SMOKE_LINE\\nPNS-T06 marker\\n'";
      const stripped = store.stripAnsi(raw);
      expect(stripped).toContain("mschwarz@mike-air rigged %");
      expect(stripped).toContain("printf 'TRACK_A_SMOKE_LINE\\nPNS-T06 marker\\n'");
      expect(stripped).not.toContain("pprintf");
      expect(stripped).not.toContain("\b");
      expect(stripped).not.toContain("\x1b");
    });
  });

  describe("enabled: false", () => {
    it("skips write operations but path resolution still works", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir, enabled: false });
      expect(store.enabled).toBe(false);
      // Path resolution still works
      expect(store.getTranscriptPath("my-rig", "dev@my-rig")).toBe(join(tmpDir, "my-rig", "dev@my-rig.log"));
      // Write operations return false/skip
      expect(store.ensureTranscriptDir("my-rig")).toBe(false);
      expect(store.writeBoundaryMarker("my-rig", "dev@my-rig", "test")).toBe(false);
      // Directory was NOT created
      expect(existsSync(join(tmpDir, "my-rig"))).toBe(false);
    });
  });

  describe("path traversal safety", () => {
    it("rig name '..' does not resolve outside transcript root", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      const path = store.getTranscriptPath("..", "dev@rig");
      // Path must stay under the root, not resolve to parent
      expect(path.startsWith(tmpDir + "/")).toBe(true);
    });

    it("ensureTranscriptDir with '..' rig name returns false", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      const result = store.ensureTranscriptDir("..");
      expect(result).toBe(false);
    });
  });

  describe("readTail", () => {
    it("returns null on missing file without throwing", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      const result = store.readTail("my-rig", "nonexistent-session", 10);
      expect(result).toBeNull();
    });

    it("returns last N lines with ANSI stripped", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      store.ensureTranscriptDir("my-rig");
      const filePath = store.getTranscriptPath("my-rig", "dev@my-rig");
      writeFileSync(filePath, "line1\nline2\nline3\n\x1b[1mline4\x1b[0m\nline5\n");

      const result = store.readTail("my-rig", "dev@my-rig", 3);
      expect(result).not.toBeNull();
      const lines = result!.split("\n").filter(Boolean);
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe("line3");
      expect(lines[1]).toBe("line4"); // ANSI stripped
      expect(lines[2]).toBe("line5");
    });
  });

  describe("grep", () => {
    it("returns matching lines with ANSI stripped", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      store.ensureTranscriptDir("my-rig");
      const filePath = store.getTranscriptPath("my-rig", "dev@my-rig");
      writeFileSync(filePath, "hello world\n\x1b[1mdecision made\x1b[0m\nfoo bar\ndecision final\n");

      const result = store.grep("my-rig", "dev@my-rig", "decision");
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result![0]).toBe("decision made"); // ANSI stripped
      expect(result![1]).toBe("decision final");
    });

    it("matches against stripped logical lines from noisy shell capture", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      store.ensureTranscriptDir("my-rig");
      const filePath = store.getTranscriptPath("my-rig", "dev@my-rig");
      writeFileSync(
        filePath,
        "printf 'TRACK_A_SMOKE_LINE\\nPNS-T06 marker\\n'\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                                \r  \r\r\x1b[0m\x1b[27m\x1b[24m\x1b[Jmschwarz@mike-air rigged % \x1b[K\x1b[?2004hprintf 'TRACK_A_GROWTH_LINE\\\\n'\n",
      );

      const result = store.grep("my-rig", "dev@my-rig", "TRACK_A_GROWTH_LINE");
      expect(result).toEqual(["printf 'TRACK_A_GROWTH_LINE\\\\n'"]);
    });

    it("returns null on missing file without throwing", () => {
      const store = new TranscriptStore({ transcriptsRoot: tmpDir });
      const result = store.grep("my-rig", "nonexistent", "pattern");
      expect(result).toBeNull();
    });
  });
});
