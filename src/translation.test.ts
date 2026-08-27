import { describe, expect, it } from "vitest";
import { needsTranslation, protect, restore, validateTranslation } from "./translation.js";

describe("Korean prompt pipeline", () => {
  it.each([
    "git status",
    "/help",
    "y",
    "1",
    "src/main/kotlin/Foo.kt",
  ])("passes through non-Korean input: %s", (input) => {
    expect(needsTranslation(input)).toBe(false);
  });

  it("detects Korean natural language in mixed developer input", () => {
    expect(needsTranslation("ReferralRewardService에서 issueReward 호출 전에 체크해줘")).toBe(true);
  });

  it("protects and restores code, commands, URLs, and paths byte-for-byte", () => {
    const input =
      "`ReferralRewardService`를 src/main/kotlin/Foo.kt에서 수정하고 ./gradlew test 실행 후 https://example.com 확인해줘";
    const protectedText = protect(input);

    expect(protectedText.masked).toBe("{K0}를 {K1}에서 수정하고 {K2} 실행 후 {K3} 확인해줘");
    expect(restore(protectedText.masked, protectedText.tokens)).toBe(input);
  });

  it("rejects explanations, Korean residue, and missing protected tokens", () => {
    expect(validateTranslation("The user wants me to translate this.", ["{K0}"])).toBe(false);
    expect(validateTranslation("Here is the translation: Fix the bug.", [])).toBe(false);
    expect(validateTranslation("Sure, I can help with that.", [])).toBe(false);
    expect(validateTranslation("OK", [])).toBe(false);
    expect(
      validateTranslation(
        "OK. I understand the request. Please provide the instruction you would like me to translate.",
        [],
      ),
    ).toBe(false);
    expect(validateTranslation("이 consumer를 확인하세요. {K0}", ["{K0}"])).toBe(false);
    expect(validateTranslation("Check the consumer.", ["{K0}"])).toBe(false);
    expect(validateTranslation("Check {K0} for idempotency.", ["{K0}"])).toBe(true);
  });

  it("rejects placeholders that were not present in the original prompt", () => {
    expect(
      validateTranslation(
        "Review the current project structure and briefly explain the role of the key files. {K0}",
        [],
      ),
    ).toBe(false);
    expect(validateTranslation("Fix {K0} and {K1}.", ["{K0}"])).toBe(false);
  });
});
