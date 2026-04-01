import type { PsEntry } from "./ps-projection.js";
import type { Rig } from "./types.js";
import type { SearchResult } from "./history-query.js";

export interface AskDeps {
  psProjectionService: { getEntries(): PsEntry[] };
  rigRepo: { findRigsByName(name: string): Rig[] };
  historyQuery: { search(rigName: string, question: string): Promise<SearchResult> };
  transcriptsEnabled: boolean;
}

export interface AskRigInfo {
  name: string;
  status: string;
  nodeCount: number;
  runningCount: number;
  uptime: string | null;
}

export interface AskResult {
  question: string;
  rig: AskRigInfo | null;
  evidence: {
    backend: string;
    excerpts: string[];
  };
  insufficient: boolean;
  guidance?: string;
}

export class AskService {
  private readonly deps: AskDeps;

  constructor(deps: AskDeps) {
    this.deps = deps;
  }

  async ask(rigName: string, question: string): Promise<AskResult> {
    // Resolve rig
    const rigs = this.deps.rigRepo.findRigsByName(rigName);

    if (rigs.length === 0) {
      return {
        question,
        rig: null,
        evidence: { backend: "rg", excerpts: [] },
        insufficient: true,
        guidance: `Rig '${rigName}' not found. List rigs with: rigged ps`,
      };
    }

    if (rigs.length > 1) {
      return {
        question,
        rig: null,
        evidence: { backend: "rg", excerpts: [] },
        insufficient: true,
        guidance: `Rig '${rigName}' is ambiguous — ${rigs.length} rigs share that name. Remove duplicates or use a unique name.`,
      };
    }

    // Get topology info
    const entries = this.deps.psProjectionService.getEntries();
    const psEntry = entries.find((e) => e.name === rigName);
    const rigInfo: AskRigInfo = psEntry
      ? { name: psEntry.name, status: psEntry.status, nodeCount: psEntry.nodeCount, runningCount: psEntry.runningCount, uptime: psEntry.uptime }
      : { name: rigName, status: "unknown", nodeCount: 0, runningCount: 0, uptime: null };

    // Check transcripts enabled
    if (!this.deps.transcriptsEnabled) {
      return {
        question,
        rig: rigInfo,
        evidence: { backend: "rg", excerpts: [] },
        insufficient: true,
        guidance: "Transcripts are disabled. Enable with: rigged config set transcripts.enabled true",
      };
    }

    // Search transcripts
    const searchResult = await this.deps.historyQuery.search(rigName, question);

    let guidance: string | undefined;
    if (searchResult.insufficient) {
      if (searchResult.noTranscriptDir) {
        guidance = `No transcript directory for rig '${rigName}'. Transcripts start automatically on next rigged up.`;
      } else if (searchResult.error) {
        // Backend failure
        guidance = searchResult.error;
      } else if (searchResult.backend === "none") {
        // No backend was used (empty keywords)
        guidance = "No useful keywords could be extracted from the question. Try a more specific question.";
      } else {
        // Search ran but found no matches
        guidance = "No matching transcript evidence found. Try different search terms.";
      }
    }

    return {
      question,
      rig: rigInfo,
      evidence: {
        backend: searchResult.backend,
        excerpts: searchResult.excerpts,
      },
      insufficient: searchResult.insufficient,
      guidance,
    };
  }
}
