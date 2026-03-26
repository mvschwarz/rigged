import { useMutation, useQueryClient } from "@tanstack/react-query";

export interface BootstrapPlanResult {
  runId: string;
  status: string;
  stages: Array<{ stage: string; status: string; detail: unknown }>;
  actionKeys?: string[];
  errors: string[];
  warnings: string[];
}

export interface BootstrapApplyResult extends BootstrapPlanResult {
  rigId?: string;
}

export function useBootstrapPlan() {
  return useMutation<BootstrapPlanResult, Error, { sourceRef: string }>({
    mutationFn: async ({ sourceRef }) => {
      const res = await fetch("/api/bootstrap/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceRef }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
  });
}

export function useBootstrapApply() {
  const queryClient = useQueryClient();
  return useMutation<BootstrapApplyResult, Error, { sourceRef: string; autoApprove?: boolean; approvedActionKeys?: string[] }>({
    mutationFn: async ({ sourceRef, autoApprove, approvedActionKeys }) => {
      const res = await fetch("/api/bootstrap/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceRef, autoApprove, approvedActionKeys }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.errors?.[0] ?? data.error ?? `HTTP ${res.status}`);
        (err as unknown as Record<string, unknown>)["data"] = data;
        throw err;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rigs", "summary"] });
    },
  });
}
