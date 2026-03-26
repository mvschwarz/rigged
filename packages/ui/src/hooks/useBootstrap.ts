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

type BootstrapErrorPayload = {
  error?: string;
  errors?: string[];
  stages?: Array<{
    detail?: {
      error?: string;
      errors?: string[];
    };
  }>;
};

function getBootstrapErrorMessage(data: BootstrapErrorPayload, status: number): string {
  const stageDetailErrors = data.stages?.flatMap((stage) => {
    const detail = stage.detail;
    if (!detail) return [];
    const errors: string[] = [];
    if (Array.isArray(detail.errors)) errors.push(...detail.errors.filter((value): value is string => typeof value === "string"));
    if (typeof detail.error === "string") errors.push(detail.error);
    return errors;
  }) ?? [];

  return (
    data.errors?.find((value): value is string => typeof value === "string") ??
    stageDetailErrors[0] ??
    data.error ??
    `HTTP ${status}`
  );
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
        const data = await res.json().catch(() => ({} as BootstrapErrorPayload));
        const err = new Error(getBootstrapErrorMessage(data, res.status));
        (err as unknown as Record<string, unknown>)["data"] = data;
        throw err;
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
        const err = new Error(getBootstrapErrorMessage(data, res.status));
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
