import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type ExecDep = (cmd: string, args: string[]) => Promise<{ stdout: string; exitCode: number }>;

export interface SearchResult {
  backend: "rg" | "grep" | "none";
  excerpts: string[];
  insufficient: boolean;
  noTranscriptDir?: boolean;
  error?: string;
}

interface HistoryQueryOpts {
  transcriptsRoot: string;
  exec: ExecDep;
}

const STOP_WORDS = new Set([
  "the", "is", "was", "are", "were", "been", "being",
  "have", "has", "had", "having",
  "does", "did", "doing",
  "will", "would", "shall", "should",
  "may", "might", "must", "can", "could",
  "and", "but", "for", "nor", "not", "yet", "also",
  "this", "that", "these", "those",
  "what", "which", "who", "whom", "whose",
  "where", "when", "why", "how",
  "all", "each", "every", "both", "few", "more", "most",
  "other", "some", "such", "than", "too", "very",
  "its", "his", "her", "our", "your", "their",
  "with", "from", "into", "about", "between", "through",
  "during", "before", "after", "above", "below",
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractKeywords(question: string): string[] {
  const words = question.split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const word of words) {
    // Strip trailing punctuation for stop-word check, but keep original for escaping
    const stripped = word.replace(/[?.!,;:]+$/, "");
    if (stripped.length < 3) continue;
    if (STOP_WORDS.has(stripped.toLowerCase())) continue;

    const escaped = escapeRegex(word.replace(/[?.!,;:]+$/, ""));
    if (seen.has(escaped)) continue;
    seen.add(escaped);
    result.push(escaped);
  }

  return result;
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[(\d*)C/g, (_: string, n: string) => " ".repeat(Math.max(1, Number(n || "1"))))
    .replace(/\x1b\[(\d*)G/g, (_: string, n: string) => " ".repeat(Math.max(1, Number(n || "1"))))
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

export class HistoryQuery {
  private readonly transcriptsRoot: string;
  private readonly exec: ExecDep;

  constructor(opts: HistoryQueryOpts) {
    this.transcriptsRoot = opts.transcriptsRoot;
    this.exec = opts.exec;
  }

  async search(rigName: string, question: string): Promise<SearchResult> {
    const rigDir = join(this.transcriptsRoot, rigName);

    if (!existsSync(rigDir)) {
      return { backend: "rg", excerpts: [], insufficient: true, noTranscriptDir: true };
    }

    const keywords = extractKeywords(question);
    if (keywords.length === 0) {
      return { backend: "none", excerpts: [], insufficient: true };
    }

    const pattern = keywords.join("|");

    // Try rg first — use -e to avoid dash-led patterns being parsed as flags
    const rgResult = await this.exec("rg", ["-i", "--no-filename", "-e", pattern, rigDir]);

    if (rgResult.exitCode === 0 || rgResult.exitCode === 1) {
      const excerpts = this.parseExcerpts(rgResult.stdout);
      // exit 0 = matches found, exit 1 = no matches → insufficient
      return { backend: "rg", excerpts, insufficient: excerpts.length === 0 };
    }

    // rg failed (exit code >= 2), fall back to grep
    const logFiles = this.getLogFiles(rigDir);
    if (logFiles.length === 0) {
      return { backend: "grep", excerpts: [], insufficient: true };
    }

    // Use -e for grep too — prevents dash-led patterns from being parsed as flags
    const grepResult = await this.exec("grep", ["-E", "-i", "-h", "-e", pattern, ...logFiles]);

    if (grepResult.exitCode === 0 || grepResult.exitCode === 1) {
      const excerpts = this.parseExcerpts(grepResult.stdout);
      return { backend: "grep", excerpts, insufficient: excerpts.length === 0 };
    }

    // Both backends failed (exit code 2+) — honest error
    return { backend: "none", excerpts: [], insufficient: true, error: "Search backends (rg, grep) both failed. Check that rg or grep is installed and the transcript directory is readable." };
  }

  private parseExcerpts(stdout: string): string[] {
    if (!stdout.trim()) return [];
    return stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => stripAnsi(line).trim())
      .filter((line) => line !== "");
  }

  private getLogFiles(dir: string): string[] {
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith(".log"))
        .map((f) => join(dir, f));
    } catch {
      return [];
    }
  }
}
