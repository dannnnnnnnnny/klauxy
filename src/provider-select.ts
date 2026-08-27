import {
  isProviderId,
  PROVIDER_IDS,
  type ProbeResult,
  type ProviderId,
  providerDefinition,
} from "./providers.js";
import type { Style } from "./tui.js";

/** How long to wait when checking whether a provider is already running. */
export const PROBE_TIMEOUT_MS = 2000;

export type Probe = (id: ProviderId, host: string, timeoutMs: number) => Promise<ProbeResult>;

export interface Availability {
  id: ProviderId;
  result: ProbeResult;
}

/** Probes every provider at its default host, in parallel. */
export async function detectProviders(probe: Probe): Promise<Availability[]> {
  return Promise.all(
    PROVIDER_IDS.map(async (id) => ({
      id,
      result: await probe(id, providerDefinition(id).defaultHost, PROBE_TIMEOUT_MS),
    })),
  );
}

/** Menu line for one provider, marking the ones already reachable. */
export function menuLine(style: Style, index: number, entry: Availability): string {
  const definition = providerDefinition(entry.id);
  const status = entry.result.reachable
    ? [style.mark("ok"), " ", style.color("green", "detected")].join("")
    : style.dim("not running");
  return [
    style.dim(`${index + 1})`),
    " ",
    definition.label,
    " - ",
    definition.description,
    "  ",
    status,
  ].join("");
}

export type Selection = { provider: ProviderId } | { error: string } | { needsInput: true };

/**
 * Resolves a menu answer to a provider.
 *
 * Accepts a 1-based index or the id itself, and treats an empty answer as
 * "use the suggested default" so pressing Enter always works.
 */
export function resolveAnswer(answer: string | null, fallback: ProviderId): Selection {
  if (answer === null) return { needsInput: true };
  const trimmed = answer.trim();
  if (trimmed.length === 0) return { provider: fallback };
  if (isProviderId(trimmed)) return { provider: trimmed };
  const index = Number(trimmed);
  const byIndex = Number.isSafeInteger(index) ? PROVIDER_IDS[index - 1] : undefined;
  return byIndex === undefined ? { error: trimmed } : { provider: byIndex };
}

/** Provider to offer as the default: the first detected one, else oMLX. */
export function suggestedDefault(availability: Availability[]): ProviderId {
  return availability.find((entry) => entry.result.reachable)?.id ?? "omlx";
}
