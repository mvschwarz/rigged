import { useMutation } from "@tanstack/react-query";

export interface InspectResult {
  manifest: { name: string; version: string; rigSpec: string; packages: Array<{ name: string; version: string; path: string }> };
  digestValid: boolean;
  integrityResult: { passed: boolean; mismatches: string[]; missing: string[]; extra: string[]; errors: string[] };
}

export interface BundleInstallResult {
  runId: string;
  status: string;
  rigId?: string;
  stages: Array<{ stage: string; status: string }>;
  errors: string[];
}

export function useBundleInspect() {
  return useMutation<InspectResult, Error, { bundlePath: string }>({
    mutationFn: async ({ bundlePath }) => {
      const res = await fetch("/api/bundles/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundlePath }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return data as InspectResult;
    },
  });
}

export function useBundleInstall() {
  return useMutation<BundleInstallResult, Error, { bundlePath: string; plan?: boolean; autoApprove?: boolean; targetRoot?: string }>({
    mutationFn: async ({ bundlePath, plan, autoApprove, targetRoot }) => {
      const res = await fetch("/api/bundles/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundlePath, plan, autoApprove, targetRoot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data;
    },
  });
}
