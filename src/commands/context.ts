import type { KlauxyPaths } from "../paths.js";
import type { Translator } from "../pipeline.js";
import type { ProbeResult, ProviderId, TranslatorSettings } from "../providers.js";
import type { Style } from "../tui.js";

/**
 * Everything a command needs from the outside world.
 *
 * The optional hooks exist so `runCommand` stays testable: a test supplies
 * fakes for install, provider probing, and translator construction instead of
 * touching the real filesystem, network, or LaunchAgent.
 */
export interface CommandContext {
  home: string;
  output(line: string): void;
  style?: Style;
  /** Terminal columns; falls back to a readable default when unknown. */
  columns?: number;
  /** Package version, shown by `klx --version`. */
  version?: string;
  prompt?(question: string): Promise<string | null>;
  /** Overrides provider reachability checks; used by tests. */
  probe?(id: ProviderId, host: string, timeoutMs: number): Promise<ProbeResult>;
  /** Overrides translator construction; used by tests. */
  createTranslator?(settings: TranslatorSettings): Translator;
  install?(): Promise<void>;
  /** Shell-specific reload instruction, resolved by the caller. */
  reloadHint?(): Promise<string>;
  uninstall?(): Promise<void>;
  doctor?(): Promise<{ ok: boolean; lines: string[] }>;
}

/** Context plus the values every handler derives from it. */
export interface CommandRun {
  args: string[];
  context: CommandContext;
  paths: KlauxyPaths;
  style: Style;
  version: string;
  /** Usable output width, already clamped. */
  width: number;
  output(line: string): void;
}

/**
 * A command handler returns an exit code, or undefined when it does not apply
 * so the dispatcher can keep looking.
 */
export type CommandHandler = (run: CommandRun) => Promise<number | undefined>;

/** Renders an aligned `label  value` line used by several commands. */
export function labelled(style: Style, label: string, value: string, width = 10): string {
  return [style.dim(label.padEnd(width)), value].join("");
}
