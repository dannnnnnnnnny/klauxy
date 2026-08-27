import { describe, expect, it } from "vitest";
import { buildSavingsGauge, estimateSavings, estimateSavingsFromText } from "./savings.js";

describe("savings estimator", () => {
  it("returns zero baseline for empty history", () => {
    expect(estimateSavings([])).toEqual({
      estimatedOriginal: 0,
      estimatedForwarded: 0,
      estimatedSaved: 0,
      estimatedSavingsPercent: 0,
    });
  });

  it("handles a single Hangul translation", () => {
    const entry = estimateSavingsFromText("구조를 설명해줘", "Explain the structure.");
    expect(entry.estimatedOriginal).toBeGreaterThan(0);
    expect(entry.estimatedForwarded).toBeGreaterThan(0);
    const result = estimateSavings([entry]);
    expect(result.estimatedOriginal).toBe(entry.estimatedOriginal);
    expect(result.estimatedForwarded).toBe(entry.estimatedForwarded);
    expect(result.estimatedSaved).toBe(result.estimatedOriginal - result.estimatedForwarded);
  });

  it("reports negative savings when translation grows", () => {
    const result = estimateSavings([{ estimatedOriginal: 3, estimatedForwarded: 12 }]);
    expect(result.estimatedSaved).toBe(-9);
    expect(result.estimatedSavingsPercent).toBeLessThan(0);
  });

  it("handles mixed Hangul and English", () => {
    const a = estimateSavingsFromText(
      "ReferralRewardService에서 issueReward 호출 전에 체크해줘",
      "Check before calling issueReward on ReferralRewardService.",
    );
    const b = estimateSavingsFromText("Fix the bug.", "Fix the bug.");
    const result = estimateSavings([a, b]);
    expect(result.estimatedOriginal).toBe(a.estimatedOriginal + b.estimatedOriginal);
    expect(result.estimatedForwarded).toBe(a.estimatedForwarded + b.estimatedForwarded);
  });

  it("handles ASCII-only text conservatively", () => {
    const entry = estimateSavingsFromText("git status", "git status");
    expect(entry.estimatedOriginal).toBe(entry.estimatedForwarded);
  });

  it("savings percent is zero when both are zero", () => {
    expect(estimateSavings([]).estimatedSavingsPercent).toBe(0);
  });

  it("savings percent is clamped between -100 and 100", () => {
    const huge = estimateSavings([{ estimatedOriginal: 1, estimatedForwarded: 1000 }]);
    expect(huge.estimatedSavingsPercent).toBeGreaterThanOrEqual(-100);
    expect(huge.estimatedSavingsPercent).toBeLessThanOrEqual(100);
  });

  it("handles whitespace and punctuation efficiently", () => {
    const entry = estimateSavingsFromText("안녕하세요. 감사합니다! ", "Thank you. ");
    expect(entry.estimatedOriginal).toBeGreaterThan(0);
  });

  it("handles code-mixed text", () => {
    const entry = estimateSavingsFromText("console.log를 테스트해줘", "Test console.log");
    expect(entry.estimatedOriginal).toBeGreaterThan(0);
    expect(entry.estimatedForwarded).toBeGreaterThan(0);
  });

  it("handles finite arithmetic for NaN/Infinity safety", () => {
    const result = estimateSavings([{ estimatedOriginal: Infinity, estimatedForwarded: 1 }]);
    expect(Number.isFinite(result.estimatedOriginal)).toBe(false);
    expect(Number.isFinite(result.estimatedSaved)).toBe(false);
    // percent should still be finite due to guard
    expect(Number.isFinite(result.estimatedSavingsPercent)).toBe(true);
  });
});

describe("savings gauge", () => {
  it("shows 0% at zero savings with no-savings label", () => {
    const gauge = buildSavingsGauge(0);
    expect(gauge).toContain("0%");
    expect(gauge).toContain("100%");
    expect(gauge).toContain("no savings");
    // At 0%, bar should be empty (no filled blocks)
    expect(gauge).toContain("░");
  });

  it("shows positive savings correctly", () => {
    const gauge = buildSavingsGauge(50);
    expect(gauge).toContain("+50%");
  });

  it("shows negative as no savings", () => {
    const gauge = buildSavingsGauge(-20);
    expect(gauge).toContain("no savings");
  });

  it("clamps to 100%", () => {
    const gauge = buildSavingsGauge(200);
    expect(gauge).toContain("+100%");
  });

  it("handles NaN safely", () => {
    const gauge = buildSavingsGauge(NaN);
    expect(gauge).toContain("no savings");
  });

  it("gauge is always 40 chars wide between brackets", () => {
    for (const pct of [-50, 0, 10, 50, 99, 100, 150]) {
      const gauge = buildSavingsGauge(pct);
      const match = gauge.match(/\[([^\]]+)\]/);
      expect(match).not.toBeNull();
      expect(match![1].length).toBe(40);
    }
  });
});
