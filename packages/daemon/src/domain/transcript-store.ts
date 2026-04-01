import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface TranscriptStoreOpts {
  transcriptsRoot?: string;
  enabled?: boolean;
}

const DEFAULT_ROOT = join(homedir(), ".rigged", "transcripts");

function applyBackspaces(text: string): string {
  const chars: string[] = [];
  for (const ch of text) {
    if (ch === "\b") {
      chars.pop();
      continue;
    }
    chars.push(ch);
  }
  return chars.join("");
}

function stripShellPromptPrefix(line: string): string {
  return line.replace(/^\S+@\S+ .*? %\s+/, "");
}

export class TranscriptStore {
  private readonly root: string;
  private readonly _enabled: boolean;

  constructor(opts?: TranscriptStoreOpts) {
    this.root = opts?.transcriptsRoot ?? DEFAULT_ROOT;
    this._enabled = opts?.enabled ?? true;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  getTranscriptPath(rigName: string, sessionName: string): string {
    const resolved = join(this.root, rigName, `${sessionName}.log`);
    // Guard against path traversal from rig/session names containing ".."
    if (!resolved.startsWith(this.root + "/") && resolved !== this.root) {
      return join(this.root, "_unsafe", `${sessionName}.log`);
    }
    return resolved;
  }

  ensureTranscriptDir(rigName: string): boolean {
    if (!this._enabled) return false;
    try {
      const dir = join(this.root, rigName);
      // Guard against path traversal
      if (!dir.startsWith(this.root + "/") && dir !== this.root) {
        return false;
      }
      mkdirSync(dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  writeBoundaryMarker(rigName: string, sessionName: string, reason: string): boolean {
    if (!this._enabled) return false;
    try {
      const filePath = this.getTranscriptPath(rigName, sessionName);
      const marker = `--- SESSION BOUNDARY: ${reason} at ${new Date().toISOString()} ---\n`;
      appendFileSync(filePath, marker, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  stripAnsi(text: string): string {
    return text
      // Preserve horizontal spacing from cursor-forward/absolute motions.
      .replace(/\x1b\[(\d*)C/g, (_, n: string) => " ".repeat(Math.max(1, Number(n || "1"))))
      .replace(/\x1b\[(\d*)G/g, (_, n: string) => " ".repeat(Math.max(1, Number(n || "1"))))
      // Strip OSC/title updates like ESC ] 0;title BEL.
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      // Strip remaining CSI and single-char escape sequences.
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\x1b[@-_]/g, "")
      // Shell redraws often emit char + backspace before replaying the line.
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[^\n]\x08/g, (match) => applyBackspaces(match))
      .replace(/\x08+/g, "")
      // Treat carriage-return redraws as separate transcript lines.
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  readTail(rigName: string, sessionName: string, lines: number): string | null {
    try {
      const filePath = this.getTranscriptPath(rigName, sessionName);
      if (!existsSync(filePath)) return null;
      const content = readFileSync(filePath, "utf-8");
      const allLines = content.split("\n");
      // Remove trailing empty line from split
      if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
        allLines.pop();
      }
      const tail = allLines.slice(-lines);
      return tail.map((l) => this.stripAnsi(l)).join("\n") + "\n";
    } catch {
      return null;
    }
  }

  grep(rigName: string, sessionName: string, pattern: string): string[] | null {
    try {
      const filePath = this.getTranscriptPath(rigName, sessionName);
      if (!existsSync(filePath)) return null;
      const content = this.stripAnsi(readFileSync(filePath, "utf-8"));
      const regex = new RegExp(pattern);
      return content
        .split("\n")
        .filter((line) => regex.test(line))
        .map((line) => stripShellPromptPrefix(line));
    } catch {
      return null;
    }
  }
}
