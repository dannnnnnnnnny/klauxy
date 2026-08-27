import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface RuntimeState {
  schema: 1;
  enabled: boolean;
  generation: number;
}

const DEFAULT_STATE: RuntimeState = { schema: 1, enabled: false, generation: 0 };

export async function readState(path: string): Promise<RuntimeState> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<RuntimeState>;
    if (
      value.schema !== 1 ||
      typeof value.enabled !== "boolean" ||
      !Number.isSafeInteger(value.generation) ||
      (value.generation ?? -1) < 0
    ) {
      return { ...DEFAULT_STATE };
    }
    return value as RuntimeState;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function writeEnabled(path: string, enabled: boolean): Promise<RuntimeState> {
  const previous = await readState(path);
  const next: RuntimeState = {
    schema: 1,
    enabled,
    generation: previous.generation + 1,
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = [path, ".tmp-", process.pid, "-", Date.now()].join("");
  await writeFile(temporaryPath, [JSON.stringify(next, null, 2), "\n"].join(""), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
  return next;
}
