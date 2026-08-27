import { describe, expect, it } from "vitest";
import {
  classifyDiagnostic,
  colorEnabled,
  createStyle,
  plainStyle,
  terminalWidth,
  wrap,
} from "./tui.js";

describe("colour detection", () => {
  it("enables colour on an interactive terminal", () => {
    expect(colorEnabled({ tty: true, env: {} })).toBe(true);
  });

  it("disables colour when output is piped", () => {
    expect(colorEnabled({ tty: false, env: {} })).toBe(false);
  });

  it("honours NO_COLOR even on a terminal", () => {
    expect(colorEnabled({ tty: true, env: { NO_COLOR: "1" } })).toBe(false);
  });

  it("lets FORCE_COLOR override an inherited NO_COLOR", () => {
    expect(colorEnabled({ tty: false, env: { NO_COLOR: "1", FORCE_COLOR: "1" } })).toBe(true);
  });

  it("treats FORCE_COLOR=0 as an explicit opt-out", () => {
    expect(colorEnabled({ tty: true, env: { FORCE_COLOR: "0" } })).toBe(false);
  });

  it("disables colour for dumb terminals", () => {
    expect(colorEnabled({ tty: true, env: { TERM: "dumb" } })).toBe(false);
  });
});

describe("styling", () => {
  it("emits escape codes when colour is on", () => {
    const style = createStyle({ tty: true, env: {} });
    expect(style.bold("hi")).toBe("\u001b[1mhi\u001b[0m");
    expect(style.color("green", "hi")).toBe("\u001b[32mhi\u001b[0m");
  });

  it("returns bare text when colour is off", () => {
    expect(plainStyle.bold("hi")).toBe("hi");
    expect(plainStyle.dim("hi")).toBe("hi");
    expect(plainStyle.color("red", "hi")).toBe("hi");
  });

  it("uses word markers instead of glyphs in plain mode", () => {
    expect(plainStyle.mark("ok")).toBe("ok");
    expect(plainStyle.mark("fail")).toBe("FAIL");
    expect(plainStyle.mark("warn")).toBe("warn");
  });

  it("uses glyphs when colour is on", () => {
    const style = createStyle({ tty: true, env: {} });
    expect(style.mark("ok")).toContain("✓");
    expect(style.mark("fail")).toContain("✗");
  });
});

describe("terminal width", () => {
  it("falls back to a readable default when columns are unknown", () => {
    expect(terminalWidth(undefined)).toBe(80);
    expect(terminalWidth(0)).toBe(80);
    expect(terminalWidth(Number.NaN)).toBe(80);
  });

  it("clamps very narrow and very wide terminals", () => {
    expect(terminalWidth(20)).toBe(40);
    expect(terminalWidth(300)).toBe(100);
    expect(terminalWidth(72)).toBe(72);
  });
});

describe("wrapping", () => {
  it("leaves short text on one line", () => {
    expect(wrap("short enough", 40)).toEqual(["short enough"]);
  });

  it("breaks on whitespace within the limit", () => {
    const lines = wrap("one two three four five six seven eight", 15);

    expect(lines.every((line) => line.length <= 15)).toBe(true);
    expect(lines.join(" ")).toBe("one two three four five six seven eight");
  });

  it("keeps an over-long word intact so it stays copyable", () => {
    const url = "https://example.com/a/very/long/path/that/exceeds/the/limit";
    const lines = wrap(`see ${url} now`, 20);

    expect(lines).toContain(url);
  });

  it("preserves existing newlines", () => {
    expect(wrap("first\nsecond", 40)).toEqual(["first", "second"]);
  });

  it("never returns an empty array", () => {
    expect(wrap("", 40)).toEqual([""]);
  });
});

describe("diagnostic classification", () => {
  it("recognises ok lines in both shapes", () => {
    expect(classifyDiagnostic("Platform: darwin/arm64 (ok)")).toBe("ok");
    expect(classifyDiagnostic("Claude: ok (/bin/sh)")).toBe("ok");
  });

  it("recognises failures", () => {
    expect(classifyDiagnostic("Ollama: failed (unreachable)")).toBe("fail");
    expect(classifyDiagnostic("Platform: linux/x64 (unsupported)")).toBe("fail");
    expect(classifyDiagnostic("oMLX: failed (requires Apple silicon)")).toBe("fail");
  });

  it("recognises warnings before ok", () => {
    expect(classifyDiagnostic("Shell: warning (alias named claude)")).toBe("warn");
  });

  it("returns undefined for unrelated text", () => {
    expect(classifyDiagnostic("Klauxy doctor")).toBeUndefined();
  });
});
