/**
 * Terminal styling helpers.
 *
 * Colour is opt-out by environment rather than always-on: piping `klx` into a
 * file or another program must produce clean text, and NO_COLOR is honoured
 * because plenty of CI and accessibility setups rely on it.
 */

export interface StyleOptions {
  /** Whether the destination stream is an interactive terminal. */
  tty: boolean;
  env: NodeJS.ProcessEnv;
}

const CODES = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
} as const;

export type ColorName = "red" | "green" | "yellow" | "cyan";

export function colorEnabled(options: StyleOptions): boolean {
  // FORCE_COLOR wins over NO_COLOR so users can override an inherited setting,
  // matching how Node and most CLIs resolve the two.
  const force = options.env.FORCE_COLOR;
  if (force !== undefined && force !== "" && force !== "0") return true;
  if (force === "0") return false;
  if (options.env.NO_COLOR !== undefined && options.env.NO_COLOR !== "") return false;
  if (options.env.TERM === "dumb") return false;
  return options.tty;
}

export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  color(name: ColorName, text: string): string;
  /** Green check, red cross, or yellow bang depending on state. */
  mark(state: "ok" | "fail" | "warn"): string;
  heading(text: string): string;
}

export function createStyle(options: StyleOptions): Style {
  const enabled = colorEnabled(options);
  const wrap = (code: string, text: string): string =>
    enabled ? [code, text, CODES.reset].join("") : text;

  // ASCII fallbacks keep alignment predictable when a terminal cannot render
  // the glyphs or when output is being parsed.
  const glyphs = enabled
    ? { ok: "✓", fail: "✗", warn: "!" }
    : { ok: "ok", fail: "FAIL", warn: "warn" };

  return {
    bold: (text) => wrap(CODES.bold, text),
    dim: (text) => wrap(CODES.dim, text),
    color: (name, text) => wrap(CODES[name], text),
    mark: (state) => {
      if (state === "ok") return wrap(CODES.green, glyphs.ok);
      if (state === "fail") return wrap(CODES.red, glyphs.fail);
      return wrap(CODES.yellow, glyphs.warn);
    },
    heading: (text) => wrap(CODES.bold, text),
  };
}

/** Style that emits no escape codes, for tests and piped output. */
export const plainStyle: Style = createStyle({ tty: false, env: { NO_COLOR: "1" } });

/**
 * Splits a `Label: value (detail)` diagnostic line into parts so callers can
 * style them independently without each call site re-parsing strings.
 */
export function classifyDiagnostic(line: string): "ok" | "fail" | "warn" | undefined {
  if (/:\s*warning\b|\(warning\)/i.test(line)) return "warn";
  if (/:\s*failed\b|\(unsupported\)|\(requires\b/i.test(line)) return "fail";
  if (/:\s*ok\b|\(ok\)/i.test(line)) return "ok";
  return undefined;
}
