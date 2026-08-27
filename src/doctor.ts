import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { type ProviderId, probeProvider, providerDefinition } from "./providers.js";

export interface DoctorOptions {
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
  claude: string;
  provider?: ProviderId;
  host: string;
  model: string;
  timeoutMs: number;
  shellDefinitions?: string[];
}

export interface DoctorResult {
  ok: boolean;
  lines: string[];
}

export async function diagnose(options: DoctorOptions): Promise<DoctorResult> {
  const lines: string[] = [];
  let ok = true;
  const supportedPlatform = options.platform === "darwin" && options.arch === "arm64";
  lines.push(
    [
      "Platform: ",
      options.platform,
      "/",
      options.arch,
      supportedPlatform ? " (ok)" : " (unsupported)",
    ].join(""),
  );
  ok &&= supportedPlatform;

  const nodeMajor = Number(options.nodeVersion.replace(/^v/, "").split(".")[0]);
  const nodeOk = Number.isInteger(nodeMajor) && nodeMajor >= 20;
  lines.push(["Node: ", options.nodeVersion, nodeOk ? " (ok)" : " (requires 20+)"].join(""));
  ok &&= nodeOk;

  try {
    await access(options.claude, constants.X_OK);
    lines.push(["Claude: ok (", options.claude, ")"].join(""));
  } catch {
    lines.push(["Claude: failed (", options.claude, ")"].join(""));
    ok = false;
  }

  const provider = options.provider ?? "omlx";
  const label = providerDefinition(provider).label;
  const probe = await probeProvider(provider, options.host, options.timeoutMs);
  if (!probe.reachable) {
    lines.push([label, ": failed (", probe.error ?? "unreachable", ")"].join(""));
    ok = false;
  } else if (probe.models.length > 0 && !probe.models.includes(options.model)) {
    lines.push([label, ": failed (model not found: ", options.model, ")"].join(""));
    ok = false;
  } else {
    lines.push([label, ": ok (", options.model, ")"].join(""));
  }
  if (
    options.shellDefinitions?.some((source) =>
      /(?:^|\n)\s*(?:alias\s+claude=|function\s+claude\b|claude\s*\(\s*\))/m.test(source),
    )
  ) {
    lines.push("Shell: warning (alias/function named claude may bypass the Klauxy shim)");
  } else {
    lines.push("Shell: ok (no claude alias/function detected)");
  }
  return { ok, lines };
}
