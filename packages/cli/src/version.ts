import { readFileSync } from "node:fs";

type PackageJson = {
  version?: string;
};

function readPackageVersion(): string {
  const packageJsonPath = new URL("../package.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PackageJson;
  return parsed.version ?? "0.0.0";
}

export const CLI_VERSION = readPackageVersion();
