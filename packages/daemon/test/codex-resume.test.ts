import { describe, it, expect, vi } from "vitest";
import { CodexResumeAdapter } from "../src/adapters/codex-resume.js";
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

describe("CodexResumeAdapter", () => {
  describe("canResume", () => {
    it("codex_id + token -> true", () => {
      const adapter = new CodexResumeAdapter(mockTmux());
      expect(adapter.canResume("codex_id", "uuid-123")).toBe(true);
    });

    it("codex_last WITHOUT token -> true", () => {
      const adapter = new CodexResumeAdapter(mockTmux());
      expect(adapter.canResume("codex_last", null)).toBe(true);
    });

    it("no token + not codex_last -> false", () => {
      const adapter = new CodexResumeAdapter(mockTmux());
      expect(adapter.canResume("codex_id", null)).toBe(false);
    });

    it("claude_name -> false (cross-harness)", () => {
      const adapter = new CodexResumeAdapter(mockTmux());
      expect(adapter.canResume("claude_name", "token")).toBe(false);
    });
  });

  describe("resume", () => {
    it("codex_id: sendText then sendKeys Enter", async () => {
      const sendText = vi.fn(async () => ({ ok: true as const }));
      const sendKeys = vi.fn(async () => ({ ok: true as const }));
      const tmux = mockTmux({ sendText, sendKeys });
      const adapter = new CodexResumeAdapter(tmux);

      await adapter.resume("r99-demo1-impl", "codex_id", "uuid-123", "/repo");

      expect(sendText).toHaveBeenCalledOnce();
      expect(sendText.mock.calls[0]![0]).toBe("r99-demo1-impl");
      expect(sendText.mock.calls[0]![1]).toBe("codex resume 'uuid-123'");
      expect(sendKeys).toHaveBeenCalledOnce();
      expect(sendKeys.mock.calls[0]![1]).toEqual(["Enter"]);
      expect(sendText.mock.invocationCallOrder[0]).toBeLessThan(sendKeys.mock.invocationCallOrder[0]!);
    });

    it("codex_last: sendText 'codex resume --last' then sendKeys Enter", async () => {
      const sendText = vi.fn(async () => ({ ok: true as const }));
      const sendKeys = vi.fn(async () => ({ ok: true as const }));
      const tmux = mockTmux({ sendText, sendKeys });
      const adapter = new CodexResumeAdapter(tmux);

      await adapter.resume("r99-demo1-impl", "codex_last", null, "/repo");

      expect(sendText).toHaveBeenCalledOnce();
      expect(sendText.mock.calls[0]![1]).toBe("codex resume --last");
      expect(sendKeys).toHaveBeenCalledOnce();
    });

    it("returns { ok: true } on success", async () => {
      const adapter = new CodexResumeAdapter(mockTmux());
      const result = await adapter.resume("r99-demo1-impl", "codex_id", "uuid-123", "/repo");
      expect(result).toEqual({ ok: true });
    });

    it("returns { ok: false, code: 'resume_failed' } on failure", async () => {
      const sendText = vi.fn(async () => ({ ok: false as const, code: "session_not_found", message: "err" }));
      const adapter = new CodexResumeAdapter(mockTmux({ sendText }));
      const result = await adapter.resume("r99-demo1-impl", "codex_id", "uuid-123", "/repo");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("resume_failed");
    });

    it("resume_type=none -> { ok: false, code: 'no_resume' }", async () => {
      const adapter = new CodexResumeAdapter(mockTmux());
      const result = await adapter.resume("r99-demo1-impl", "none", null, "/repo");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("no_resume");
    });

    it("no token + not codex_last -> { ok: false, code: 'no_resume' }", async () => {
      const adapter = new CodexResumeAdapter(mockTmux());
      const result = await adapter.resume("r99-demo1-impl", "codex_id", null, "/repo");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("no_resume");
    });

    it("shell-sensitive token is quoted in command", async () => {
      const sendText = vi.fn(async () => ({ ok: true as const }));
      const sendKeys = vi.fn(async () => ({ ok: true as const }));
      const adapter = new CodexResumeAdapter(mockTmux({ sendText, sendKeys }));

      await adapter.resume("r99-demo1-impl", "codex_id", "uuid; rm -rf /", "/repo");

      expect(sendText.mock.calls[0]![1]).toBe("codex resume 'uuid; rm -rf /'");
    });

    it("sendKeys(Enter) fails after sendText -> C-c sent to clear buffer", async () => {
      const sendText = vi.fn(async () => ({ ok: true as const }));
      const sendKeys = vi.fn()
        .mockResolvedValueOnce({ ok: false as const, code: "session_not_found", message: "err" })
        .mockResolvedValueOnce({ ok: true as const });
      const adapter = new CodexResumeAdapter(mockTmux({ sendText, sendKeys }));

      const result = await adapter.resume("r99-demo1-impl", "codex_id", "uuid-123", "/repo");

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("resume_failed");
      expect(sendKeys).toHaveBeenCalledTimes(2);
      expect(sendKeys.mock.calls[1]![1]).toEqual(["C-c"]);
    });

    it("sendText fails -> NO C-c attempt", async () => {
      const sendText = vi.fn(async () => ({ ok: false as const, code: "session_not_found", message: "err" }));
      const sendKeys = vi.fn(async () => ({ ok: true as const }));
      const adapter = new CodexResumeAdapter(mockTmux({ sendText, sendKeys }));

      await adapter.resume("r99-demo1-impl", "codex_id", "uuid-123", "/repo");

      expect(sendKeys).not.toHaveBeenCalled();
    });
  });
});
