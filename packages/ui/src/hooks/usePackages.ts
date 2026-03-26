import { useQuery } from "@tanstack/react-query";

export interface PackageSummary {
  id: string;
  name: string;
  version: string;
  sourceKind: string;
  sourceRef: string;
  manifestHash: string;
  summary: string | null;
  createdAt: string;
  installCount: number;
  latestInstallStatus: string | null;
}

async function fetchPackageSummaries(): Promise<PackageSummary[]> {
  const res = await fetch("/api/packages/summary");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function usePackages() {
  return useQuery({
    queryKey: ["packages"],
    queryFn: fetchPackageSummaries,
  });
}
