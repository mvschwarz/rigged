import { useEffect, useRef, useState, useCallback } from "react";

const DEBOUNCE_MS = 100;

export interface UseRigEventsResult {
  connected: boolean;
  reconnecting: boolean;
}

export function useRigEvents(
  rigId: string | null,
  onEvent: () => void
): UseRigEventsResult {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const hasErroredRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const debouncedOnEvent = useCallback(() => {
    if (debounceTimerRef.current) return;
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      onEventRef.current();
    }, DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    if (!rigId) {
      setConnected(false);
      setReconnecting(false);
      return;
    }

    // Reset state for new rig — clears stale reconnecting from previous rig
    hasErroredRef.current = false;
    setConnected(false);
    setReconnecting(false);
    const es = new EventSource(`/api/events?rigId=${rigId}`);

    es.addEventListener("open", () => {
      setConnected(true);
      if (hasErroredRef.current) {
        // Reconnect after error — clear indicator and trigger refetch
        setReconnecting(false);
        hasErroredRef.current = false;
        debouncedOnEvent();
      }
    });

    es.addEventListener("message", () => {
      debouncedOnEvent();
    });

    es.addEventListener("error", () => {
      setConnected(false);
      setReconnecting(true);
      hasErroredRef.current = true;
    });

    return () => {
      es.close();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [rigId, debouncedOnEvent]);

  return { connected, reconnecting };
}
