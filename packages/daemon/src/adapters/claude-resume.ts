import type { TmuxAdapter } from "./tmux.js";

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

  async resume(
    tmuxSessionName: string,
    resumeType: string | null,
    resumeToken: string | null,
    _cwd: string
  ): Promise<ResumeResult> {
    if (!this.canResume(resumeType, resumeToken)) {
      return { ok: false, code: "no_resume", message: "Claude resume not available" };
    }

    const cmd = `claude --resume ${resumeToken}`;

    const textResult = await this.tmux.sendText(tmuxSessionName, cmd);
    if (!textResult.ok) {
      return { ok: false, code: "resume_failed", message: textResult.message };
    }

    const keyResult = await this.tmux.sendKeys(tmuxSessionName, ["Enter"]);
    if (!keyResult.ok) {
      return { ok: false, code: "resume_failed", message: keyResult.message };
    }

    return { ok: true };
  }
}
