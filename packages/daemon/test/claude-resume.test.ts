import { describe, it, expect, vi } from "vitest";
import { ClaudeResumeAdapter } from "../src/adapters/claude-resume.js";
import type { TmuxAdapter, TmuxResult } from "../src/adapters/tmux.js";

function mockTmux(overrides?: {
  sendText?: (target: string, text: string) => Promise<TmuxResult>;
  sendKeys?: (target: string, keys: string[]) => Promise<TmuxResult>;
}) {
  return {
    sendText: overrides?.sendText ?? vi.fn(async () => ({ ok: true as const })),
    sendKeys: overrides?.sendKeys ?? vi.fn(async () => ({ ok: true as const })),
    createSession: async () => ({ ok: true as const }),
    killSession: async () => ({ ok: true as const }),
    listSessions: async () => [],
    listWindows: async () => [],
    listPanes: async () => [],
    hasSession: async () => false,
  } as unknown as TmuxAdapter;
}

describe("ClaudeResumeAdapter", () => {
  describe("canResume", () => {
    it("claude_name + token -> true", () => {
      const adapter = new ClaudeResumeAdapter(mockTmux());
      expect(adapter.canResume("claude_name", "my-session")).toBe(true);
    });

    it("claude_id + token -> true", () => {
      const adapter = new ClaudeResumeAdapter(mockTmux());
      expect(adapter.canResume("claude_id", "abc-123")).toBe(true);
    });

    it("no token -> false", () => {
      const adapter = new ClaudeResumeAdapter(mockTmux());
      expect(adapter.canResume("claude_name", null)).toBe(false);
    });

    it("resume_type=none -> false", () => {
      const adapter = new ClaudeResumeAdapter(mockTmux());
      expect(adapter.canResume("none", "token")).toBe(false);
    });

    it("codex_id -> false (cross-harness)", () => {
      const adapter = new ClaudeResumeAdapter(mockTmux());
      expect(adapter.canResume("codex_id", "token")).toBe(false);
    });
  });

  describe("resume", () => {
    it("sends sendText then sendKeys Enter", async () => {
      const sendText = vi.fn(async () => ({ ok: true as const }));
      const sendKeys = vi.fn(async () => ({ ok: true as const }));
      const tmux = mockTmux({ sendText, sendKeys });
      const adapter = new ClaudeResumeAdapter(tmux);

      await adapter.resume("r99-demo1-lead", "claude_name", "my-session", "/repo");

      expect(sendText).toHaveBeenCalledOnce();
      expect(sendText.mock.calls[0]![0]).toBe("r99-demo1-lead");
      expect(sendText.mock.calls[0]![1]).toBe("claude --resume my-session");
      expect(sendKeys).toHaveBeenCalledOnce();
      expect(sendKeys.mock.calls[0]![0]).toBe("r99-demo1-lead");
      expect(sendKeys.mock.calls[0]![1]).toEqual(["Enter"]);
      // sendText called before sendKeys
      expect(sendText.mock.invocationCallOrder[0]).toBeLessThan(sendKeys.mock.invocationCallOrder[0]!);
    });

    it("returns { ok: true } on success", async () => {
      const adapter = new ClaudeResumeAdapter(mockTmux());
      const result = await adapter.resume("r99-demo1-lead", "claude_name", "my-session", "/repo");
      expect(result).toEqual({ ok: true });
    });

    it("returns { ok: false, code: 'resume_failed' } on sendText failure", async () => {
      const sendText = vi.fn(async () => ({ ok: false as const, code: "session_not_found", message: "err" }));
      const adapter = new ClaudeResumeAdapter(mockTmux({ sendText }));
      const result = await adapter.resume("r99-demo1-lead", "claude_name", "my-session", "/repo");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("resume_failed");
    });

    it("resume_type=none -> { ok: false, code: 'no_resume' }", async () => {
      const adapter = new ClaudeResumeAdapter(mockTmux());
      const result = await adapter.resume("r99-demo1-lead", "none", "token", "/repo");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("no_resume");
    });

    it("no token -> { ok: false, code: 'no_resume' }", async () => {
      const adapter = new ClaudeResumeAdapter(mockTmux());
      const result = await adapter.resume("r99-demo1-lead", "claude_name", null, "/repo");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("no_resume");
    });
  });
});
