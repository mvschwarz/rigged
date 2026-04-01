import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export interface ChatMessage {
  id: string;
  rigId: string;
  sender: string;
  kind: string;
  body: string;
  topic: string | null;
  createdAt: string;
}

async function fetchChatHistory(rigId: string): Promise<ChatMessage[]> {
  const res = await fetch(`/api/rigs/${encodeURIComponent(rigId)}/chat/history?limit=50`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function sendChatMessage(rigId: string, body: string, sender: string): Promise<ChatMessage> {
  const res = await fetch(`/api/rigs/${encodeURIComponent(rigId)}/chat/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, body }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function useRigChat(rigId: string) {
  const queryClient = useQueryClient();

  const historyQuery = useQuery({
    queryKey: ["rig", rigId, "chat"],
    queryFn: () => fetchChatHistory(rigId),
    enabled: !!rigId,
  });

  const sendMutation = useMutation({
    mutationFn: ({ body, sender }: { body: string; sender: string }) =>
      sendChatMessage(rigId, body, sender),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rig", rigId, "chat"] });
    },
  });

  // SSE live updates — listen for chat.message events
  useEffect(() => {
    if (!rigId) return;

    const es = new EventSource(`/api/rigs/${encodeURIComponent(rigId)}/chat/watch`);

    es.addEventListener("message", () => {
      // Invalidate to refetch on new messages
      queryClient.invalidateQueries({ queryKey: ["rig", rigId, "chat"] });
    });

    return () => {
      es.close();
    };
  }, [rigId, queryClient]);

  return {
    messages: historyQuery.data ?? [],
    isLoading: historyQuery.isPending,
    error: historyQuery.error,
    send: sendMutation.mutate,
    isSending: sendMutation.isPending,
  };
}
