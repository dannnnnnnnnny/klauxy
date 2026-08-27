export interface TokenEstimate {
  estimatedOriginal: number;
  estimatedForwarded: number;
  estimatedSaved: number;
  estimatedSavingsPercent: number;
}

export interface SavingsEntry {
  estimatedOriginal: number;
  estimatedForwarded: number;
}

function estimateTokensForText(text: string): number {
  if (text.length === 0) return 0;
  let count = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) ?? 0;
    const isHangul = cp >= 0xac00 && cp <= 0xd7a3;
    const isHangulJamo = cp >= 0x3131 && cp <= 0x318e;
    if (isHangul || isHangulJamo) {
      count += 3;
      i += 1;
    } else if (cp <= 0x7f) {
      count += 0.25;
      i += 1;
    } else if (cp <= 0xffff) {
      count += 0.75;
      i += 1;
    } else {
      count += 1;
      i += 2;
    }
  }
  return Math.max(1, Math.ceil(count));
}

export function estimateSavings(entries: ReadonlyArray<SavingsEntry>): TokenEstimate {
  let totalOriginal = 0;
  let totalForwarded = 0;
  for (const entry of entries) {
    totalOriginal += entry.estimatedOriginal;
    totalForwarded += entry.estimatedForwarded;
  }
  const estimatedSaved = totalOriginal - totalForwarded;
  let estimatedSavingsPercent = 0;
  if (totalOriginal > 0) {
    const raw = ((totalOriginal - totalForwarded) / totalOriginal) * 100;
    if (!Number.isFinite(raw)) {
      estimatedSavingsPercent = 0;
    } else {
      estimatedSavingsPercent = Math.round(Math.min(Math.max(raw, -100), 100));
    }
  }
  return {
    estimatedOriginal: totalOriginal,
    estimatedForwarded: totalForwarded,
    estimatedSaved: estimatedSaved,
    estimatedSavingsPercent,
  };
}

export function estimateSavingsFromText(original: string, sent: string): SavingsEntry {
  return {
    estimatedOriginal: estimateTokensForText(original),
    estimatedForwarded: estimateTokensForText(sent),
  };
}

export function buildSavingsGauge(percent: number): string {
  const safe = Number.isFinite(percent) ? percent : 0;
  const clamped = Math.max(0, Math.min(100, safe));
  const width = 40;
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
  if (clamped <= 0) {
    return `  0% ${bar} 100%  (no savings)`;
  }
  return `  0% ${bar} 100%  (+${clamped}%)`;
}
