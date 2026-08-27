import { chmod, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type HistoryStatus = "translated" | "failed";

export interface HistoryEntry {
  schema: 1;
  timestamp: string;
  status: HistoryStatus;
  durationMs: number;
  original: string;
  sent: string;
  failure?: string;
}

const MAX_ENTRIES = 100;

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Partial<HistoryEntry>;
  return (
    entry.schema === 1 &&
    (entry.status === "translated" || entry.status === "failed") &&
    typeof entry.timestamp === "string" &&
    typeof entry.durationMs === "number" &&
    Number.isFinite(entry.durationMs) &&
    typeof entry.original === "string" &&
    typeof entry.sent === "string" &&
    (entry.failure === undefined || typeof entry.failure === "string")
  );
}

export async function readHistory(path: string): Promise<HistoryEntry[]> {
  try {
    const content = await readFile(path, "utf8");
    const entries: HistoryEntry[] = [];
    for (const line of content.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (isHistoryEntry(value)) entries.push(value);
      } catch {
        // Ignore an incomplete or malformed line instead of hiding valid history.
      }
    }
    return entries.slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Serialises writers within this process.
 *
 * Background Claude workers share one history file, so appends collide. Queueing
 * in memory first means same-process writers never spin on the lock file at all;
 * the on-disk lock is left to coordinate separate processes.
 */
const queues = new Map<string, Promise<unknown>>();

/** Lock retry backoff: short at first, then easing off under contention. */
function backoffMs(attempt: number): number {
  return Math.min(2 ** Math.min(attempt, 5), 40);
}

async function acquireFileLock(path: string, lockPath: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 100) throw error;
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
    }
  }
}

async function withLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  const run = async (): Promise<T> => {
    await acquireFileLock(path, lockPath);
    try {
      return await operation();
    } finally {
      await rm(lockPath, { force: true });
    }
  };

  // Chain onto any in-flight write for this path, ignoring its outcome so one
  // failed append never blocks the next.
  const previous = queues.get(path) ?? Promise.resolve();
  const settled = previous.then(run, run);
  const tail = settled.catch(() => undefined);
  queues.set(path, tail);

  // Drop the entry once this is the last write so the map cannot grow unbounded.
  void tail.then(() => {
    if (queues.get(path) === tail) queues.delete(path);
  });

  return settled;
}

async function writeEntries(path: string, entries: HistoryEntry[]): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(temporary, content.length === 0 ? "" : `${content}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function appendHistory(path: string, entry: HistoryEntry): Promise<void> {
  await withLock(path, async () => {
    const entries = await readHistory(path);
    entries.push(entry);
    await writeEntries(path, entries.slice(-MAX_ENTRIES));
  });
}

export async function clearHistory(path: string): Promise<void> {
  await withLock(path, () => writeEntries(path, []));
}
