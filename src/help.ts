import type { Style } from "./tui.js";

export interface CommandDoc {
  name: string;
  args?: string;
  summary: string;
  group: "setup" | "control" | "inspect" | "config";
}

export const COMMANDS: readonly CommandDoc[] = [
  {
    name: "setup",
    args: "[--provider <id>]",
    summary: "one-step first run: pick, wire, enable",
    group: "setup",
  },
  {
    name: "init",
    args: "[--provider <id>]",
    summary: "choose the translation provider",
    group: "setup",
  },
  { name: "install", summary: "wrap the claude command and start the proxy", group: "setup" },
  { name: "uninstall", summary: "undo install and restore Claude settings", group: "setup" },
  { name: "on", summary: "start translating", group: "control" },
  { name: "off", summary: "stop translating", group: "control" },
  { name: "status", summary: "show whether translation is on", group: "control" },
  {
    name: "try",
    args: "[text]",
    summary: "translate one sample to check the setup",
    group: "inspect",
  },
  {
    name: "provider",
    args: "[<id>]",
    summary: "list or switch translation provider",
    group: "control",
  },
  {
    name: "history",
    args: "[--last <n>|clear]",
    summary: "recent original/sent prompt pairs",
    group: "inspect",
  },
  { name: "savings", summary: "estimated token savings", group: "inspect" },
  { name: "doctor", summary: "diagnose platform, Claude, and provider", group: "inspect" },
  {
    name: "config",
    args: "get|set <key> <value>",
    summary: "read or update configuration",
    group: "config",
  },
] as const;

const GROUP_TITLES: Record<CommandDoc["group"], string> = {
  setup: "Setup",
  control: "Control",
  inspect: "Inspect",
  config: "Configure",
};

export const COMMAND_NAMES: readonly string[] = COMMANDS.map((command) => command.name);

/**
 * Levenshtein distance, capped early.
 *
 * Only used to suggest a command after a typo, so an exact score beyond a small
 * edit distance is not worth computing.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        substitution,
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
      );
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/** Closest command name within a plausible typo distance, if any. */
export function suggestCommand(input: string): string | undefined {
  const candidate = input.toLowerCase();
  let best: { name: string; distance: number } | undefined;
  for (const name of COMMAND_NAMES) {
    const distance = editDistance(candidate, name);
    if (best === undefined || distance < best.distance) best = { name, distance };
  }
  if (best === undefined) return undefined;
  const limit = candidate.length <= 4 ? 1 : 2;
  return best.distance <= limit ? best.name : undefined;
}

export function renderHelp(style: Style, version: string): string[] {
  const lines: string[] = [];
  lines.push([style.bold("klauxy"), " ", style.dim(version)].join(""));
  lines.push("");
  lines.push("Translates Korean prompts to English before they reach Claude Code.");
  lines.push("");
  lines.push([style.dim("Usage:"), " klx <command> [options]"].join(""));

  const width = Math.max(
    ...COMMANDS.map((command) => [command.name, command.args].filter(Boolean).join(" ").length),
  );
  let group: CommandDoc["group"] | undefined;
  for (const command of COMMANDS) {
    if (command.group !== group) {
      group = command.group;
      lines.push("");
      lines.push(style.dim(GROUP_TITLES[group]));
    }
    const invocation = [command.name, command.args].filter(Boolean).join(" ");
    lines.push(["  ", invocation.padEnd(width + 2), style.dim(command.summary)].join(""));
  }

  lines.push("");
  lines.push([style.bold("First run:"), " klx setup"].join(""));
  lines.push(style.dim("Then use the normal claude command and type Korean."));
  return lines;
}
