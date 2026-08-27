import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Writes a file through a temporary path and a rename.
 *
 * Shims, manifests, and shell startup files are read by other processes while
 * Klauxy is installing, so a partially written file would be observable. Rename
 * is atomic within a filesystem, which makes the swap all-or-nothing.
 */
export async function atomicWrite(path: string, content: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = [path, ".tmp-", process.pid, "-", Date.now()].join("");
  await writeFile(temporary, content, { encoding: "utf8", mode });
  await rename(temporary, path);
}
