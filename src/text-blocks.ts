/**
 * Packing several text blocks into one translation request and splitting the
 * result back apart.
 *
 * One request per message keeps latency down and gives the model the whole
 * prompt as context, but it means the boundaries have to survive the round trip.
 * A visible marker is used rather than an invisible delimiter so a model that
 * reformats whitespace does not silently merge two blocks.
 */

function separator(index: number): string {
  return `\n\n\`KLAUXY_TEXT_BLOCK_${index}\`\n\n`;
}

/** Joins blocks with markers the model is told to preserve. */
export function packBlocks(texts: readonly string[]): string {
  return texts.map((text, index) => (index === 0 ? text : separator(index - 1) + text)).join("");
}

export type UnpackResult = { texts: string[] } | { error: string };

/**
 * Splits a translation back into the same number of blocks it was packed from.
 *
 * Returns an error rather than guessing when a marker is missing or duplicated:
 * silently misaligning blocks would put one block's translation into another's
 * position, which is worse than sending the original prompt unchanged.
 */
export function unpackBlocks(translated: string, count: number): UnpackResult {
  if (count <= 0) return { error: "no text blocks to unpack" };

  const texts: string[] = [];
  let remaining = translated;
  for (let index = 0; index < count - 1; index += 1) {
    const parts = remaining.split(separator(index));
    if (parts.length !== 2) return { error: "invalid translated text block boundaries" };
    texts.push((parts[0] as string).trim());
    remaining = parts[1] as string;
  }
  texts.push(remaining.trim());

  if (texts.some((text) => text.length === 0)) return { error: "empty translated text block" };
  return { texts };
}
