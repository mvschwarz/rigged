import type { TmuxAdapter } from "./tmux.js";
import type { ResumeResult } from "./claude-resume.js";

const CODEX_TYPES = new Set(["codex_id", "codex_last"]);

export { type ResumeResult };

export class CodexResumeAdapter {
  constructor(private tmux: TmuxAdapter) {}

  canResume(resumeType: string | null, resumeToken: string | null): boolean {
    if (!resumeType || !CODEX_TYPES.has(resumeType)) return false;
    // codex_last does not need a token
    if (resumeType === "codex_last") return true;
    // codex_id needs a token
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
      return { ok: false, code: "no_resume", message: "Codex resume not available" };
    }

    const cmd = resumeType === "codex_last"
      ? "codex resume --last"
      : `codex resume ${resumeToken}`;

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
