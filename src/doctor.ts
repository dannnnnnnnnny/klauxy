import { constants } from "node:fs";
import { access } from "node:fs/promises";

export interface DoctorOptions {
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
  claude: string;
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch([options.host.replace(/\/$/, ""), "/v1/models"].join(""), {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(["HTTP ", response.status].join(""));
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const models =
      body.data?.flatMap((item) => (typeof item.id === "string" ? [item.id] : [])) ?? [];
    if (!models.includes(options.model))
      throw new Error(["model not found: ", options.model].join(""));
    lines.push(["oMLX: ok (", options.model, ")"].join(""));
  } catch (error) {
    lines.push(
      ["oMLX: failed (", error instanceof Error ? error.message : String(error), ")"].join(""),
    );
    ok = false;
  } finally {
    clearTimeout(timer);
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
