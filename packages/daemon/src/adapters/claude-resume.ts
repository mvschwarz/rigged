import type { TmuxAdapter } from "./tmux.js";
import { shellQuote } from "./shell-quote.js";

export type ResumeResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

const CLAUDE_TYPES = new Set(["claude_name", "claude_id"]);

export class ClaudeResumeAdapter {
  constructor(private tmux: TmuxAdapter) {}

  canResume(resumeType: string | null, resumeToken: string | null): boolean {
    if (!resumeType || !CLAUDE_TYPES.has(resumeType)) return false;
    if (!resumeToken) return false;
    return true;
  }

  // NOTE: Resume success is fire-and-forget. sendText succeeding means the
  // command was typed into the tmux pane, NOT that the harness actually resumed.
  // Verifying actual harness resume state requires polling or harness-specific
  // status detection, which is a Phase 3 concern.
  // TODO(Phase 3): Add resume verification (e.g., poll harness status endpoint).
  async resume(
    tmuxSessionName: string,
    resumeType: string | null,
    resumeToken: string | null,
    _cwd: string
  ): Promise<ResumeResult> {
    if (!this.canResume(resumeType, resumeToken)) {
      return { ok: false, code: "no_resume", message: "Claude resume not available" };
    }

    const cmd = `claude --resume ${shellQuote(resumeToken!)}`;

    const textResult = await this.tmux.sendText(tmuxSessionName, cmd);
    if (!textResult.ok) {
      // sendText failed — nothing in the buffer, no cleanup needed
      return { ok: false, code: "resume_failed", message: textResult.message };
    }

    const keyResult = await this.tmux.sendKeys(tmuxSessionName, ["Enter"]);
    if (!keyResult.ok) {
      // Partial failure: command text is in the buffer but Enter failed.
      // Best-effort cleanup: send C-c to clear the typed command.
      await this.tmux.sendKeys(tmuxSessionName, ["C-c"]);
      return { ok: false, code: "resume_failed", message: keyResult.message };
    }

    return { ok: true };
  }
}
