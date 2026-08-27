import { describe, expect, it } from "vitest";
import { claudeEnvironment } from "./launcher-env.js";

describe("Claude launcher environment", () => {
  it("routes Claude through the persistent Klauxy proxy", () => {
    const environment = claudeEnvironment(
      { PATH: "/usr/bin", ANTHROPIC_BASE_URL: "http://old.example" },
      "http://127.0.0.1:54321",
    );

    expect(environment).toMatchObject({
      PATH: "/usr/bin",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:54321",
      KLAUXY: "1",
    });
  });

  it("does not claim Claude's unsupported process-wrapper contract", () => {
    const environment = claudeEnvironment({}, "http://127.0.0.1:54321");

    expect(environment.CLAUDE_CODE_PROCESS_WRAPPER).toBeUndefined();
  });
});
