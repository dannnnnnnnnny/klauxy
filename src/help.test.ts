import { describe, expect, it } from "vitest";
import { COMMAND_NAMES, editDistance, renderHelp, suggestCommand } from "./help.js";
import { plainStyle } from "./tui.js";

describe("edit distance", () => {
  it("scores identical and empty inputs", () => {
    expect(editDistance("install", "install")).toBe(0);
    expect(editDistance("", "on")).toBe(2);
    expect(editDistance("on", "")).toBe(2);
  });

  it("scores single-character edits as one", () => {
    expect(editDistance("instal", "install")).toBe(1);
    expect(editDistance("doctro", "doctor")).toBe(2);
    expect(editDistance("of", "off")).toBe(1);
  });
});

describe("command suggestions", () => {
  it("suggests the intended command for a near miss", () => {
    expect(suggestCommand("instal")).toBe("install");
    expect(suggestCommand("provder")).toBe("provider");
    expect(suggestCommand("histry")).toBe("history");
    expect(suggestCommand("doctro")).toBe("doctor");
  });

  it("stays silent when nothing is close enough", () => {
    expect(suggestCommand("deploy")).toBeUndefined();
    expect(suggestCommand("xyzzy")).toBeUndefined();
  });

  it("is case insensitive", () => {
    expect(suggestCommand("INSTALL")).toBe("install");
  });

  it("keeps short commands from matching each other loosely", () => {
    // "on" and "off" differ by 2; a short input must not suggest the wrong one.
    expect(suggestCommand("on")).toBe("on");
    expect(suggestCommand("off")).toBe("off");
  });
});

describe("help output", () => {
  it("lists every documented command exactly once", () => {
    const text = renderHelp(plainStyle, "1.2.3").join("\n");

    for (const name of COMMAND_NAMES) {
      expect(text).toContain(name);
    }
  });

  it("shows the version and the first-run sequence", () => {
    const text = renderHelp(plainStyle, "1.2.3").join("\n");

    expect(text).toContain("1.2.3");
    expect(text).toContain("klx init");
    expect(text).toContain("klx install");
    expect(text).toContain("klx on");
  });

  it("groups commands under headings", () => {
    const text = renderHelp(plainStyle, "1.2.3").join("\n");

    expect(text).toContain("Setup");
    expect(text).toContain("Control");
    expect(text).toContain("Inspect");
    expect(text).toContain("Configure");
  });

  it("emits no escape codes under the plain style", () => {
    const text = renderHelp(plainStyle, "1.2.3").join("\n");

    expect(text).not.toContain("\u001b[");
  });
});
