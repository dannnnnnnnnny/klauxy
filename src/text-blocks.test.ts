import { describe, expect, it } from "vitest";
import { packBlocks, unpackBlocks } from "./text-blocks.js";

describe("packing text blocks", () => {
  it("leaves a single block untouched", () => {
    expect(packBlocks(["only"])).toBe("only");
  });

  it("inserts a marker between blocks", () => {
    const packed = packBlocks(["first", "second"]);

    expect(packed).toContain("first");
    expect(packed).toContain("second");
    expect(packed).toContain("KLAUXY_TEXT_BLOCK_0");
  });

  it("numbers markers so order survives the round trip", () => {
    const packed = packBlocks(["a", "b", "c"]);

    expect(packed).toContain("KLAUXY_TEXT_BLOCK_0");
    expect(packed).toContain("KLAUXY_TEXT_BLOCK_1");
    expect(packed).not.toContain("KLAUXY_TEXT_BLOCK_2");
  });
});

describe("unpacking a translation", () => {
  it("round-trips the blocks it packed", () => {
    const texts = ["first block", "second block", "third block"];

    expect(unpackBlocks(packBlocks(texts), texts.length)).toEqual({ texts });
  });

  it("returns a single block unchanged", () => {
    expect(unpackBlocks("just one", 1)).toEqual({ texts: ["just one"] });
  });

  it("trims whitespace the model added around markers", () => {
    const packed = packBlocks(["a", "b"]).replace("a", "  a  ");

    expect(unpackBlocks(packed, 2)).toEqual({ texts: ["a", "b"] });
  });

  it("refuses to guess when a marker is missing", () => {
    // Losing a marker would put one block's translation in another's slot.
    expect(unpackBlocks("first second", 2)).toEqual({
      error: "invalid translated text block boundaries",
    });
  });

  it("refuses to guess when a marker is duplicated", () => {
    const marker = "\n\n`KLAUXY_TEXT_BLOCK_0`\n\n";

    expect(unpackBlocks(`a${marker}b${marker}c`, 2)).toEqual({
      error: "invalid translated text block boundaries",
    });
  });

  it("rejects a block that came back empty", () => {
    expect(unpackBlocks(packBlocks(["a", ""]), 2)).toEqual({
      error: "empty translated text block",
    });
  });

  it("rejects a zero block count", () => {
    expect(unpackBlocks("anything", 0)).toEqual({ error: "no text blocks to unpack" });
  });

  it("keeps blocks aligned when their text is similar", () => {
    const texts = ["Fix the bug.", "Fix the bug."];

    expect(unpackBlocks(packBlocks(texts), 2)).toEqual({ texts });
  });
});
