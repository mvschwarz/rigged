import { useState } from "react";
import { useRigChat } from "../hooks/useRigChat.js";

interface RigChatPanelProps {
  rigId: string;
}

export function RigChatPanel({ rigId }: RigChatPanelProps) {
  const { messages, isLoading, send, isSending } = useRigChat(rigId);
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    send({ body: text, sender: "ui" });
    setInput("");
  };

  return (
    <div data-testid="rig-chat-panel" className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {isLoading ? (
          <div className="font-mono text-[10px] text-stone-400 text-center">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="font-mono text-[10px] text-stone-400 text-center italic">No messages yet</div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} data-testid={`chat-msg-${msg.id}`} className="font-mono text-[10px] leading-4">
              {msg.kind === "topic" ? (
                <div className="text-stone-400 text-center text-[9px]">--- topic: {msg.topic} ---</div>
              ) : (
                <div>
                  <span data-testid={`chat-sender-${msg.id}`} className="font-semibold text-stone-600">[{msg.sender}]</span>{" "}
                  <span>{msg.body}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Send form */}
      <form data-testid="chat-send-form" onSubmit={handleSubmit} className="border-t border-stone-200 p-2 flex gap-2">
        <input
          data-testid="chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 px-2 py-1 border border-stone-300 font-mono text-[10px]"
          disabled={isSending}
        />
        <button
          data-testid="chat-send-btn"
          type="submit"
          disabled={isSending || !input.trim()}
          className="px-3 py-1 border border-stone-300 font-mono text-[9px] uppercase hover:bg-stone-200 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
