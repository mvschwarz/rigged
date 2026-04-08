import type { TmuxAdapter } from "../adapters/tmux.js";
import type { TranscriptStore } from "./transcript-store.js";

export async function startTmuxTranscriptCapture(
  tmuxAdapter: TmuxAdapter | null | undefined,
  transcriptStore: TranscriptStore | null | undefined,
  rigName: string,
  sessionName: string,
): Promise<{ started: boolean; reason?: string }> {
  if (!tmuxAdapter || !transcriptStore?.enabled) {
    return { started: false, reason: "transcript_capture_unavailable" };
  }

  if (!transcriptStore.ensureTranscriptDir(rigName)) {
    return { started: false, reason: "transcript_dir_unavailable" };
  }

  const transcriptPath = transcriptStore.getTranscriptPath(rigName, sessionName);
  const pipeResult = await tmuxAdapter.startPipePane(sessionName, transcriptPath);
  if (!pipeResult.ok) {
    return { started: false, reason: pipeResult.message };
  }

  return { started: true };
}
