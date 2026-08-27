import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function installRuntime(sourceRoot: string, destination: string): Promise<void> {
  const temporary = [destination, ".tmp-", process.pid, "-", Date.now()].join("");
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  await cp(join(sourceRoot, "dist"), join(temporary, "dist"), { recursive: true });
  const packageJson = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    [key: string]: unknown;
  };
  const copied = new Set<string>();
  const copyDependency = async (name: string): Promise<void> => {
    if (copied.has(name)) return;
    copied.add(name);
    const source = join(sourceRoot, "node_modules", name);
    const target = join(temporary, "node_modules", name);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
    try {
      const dependencyPackage = JSON.parse(
        await readFile(join(source, "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> };
      await Promise.all(Object.keys(dependencyPackage.dependencies ?? {}).map(copyDependency));
    } catch {
      // A minimal vendored dependency may omit package metadata.
    }
  };
  await Promise.all(Object.keys(packageJson.dependencies ?? {}).map(copyDependency));
  await writeFile(
    join(temporary, "package.json"),
    [JSON.stringify(packageJson, null, 2), "\n"].join(""),
    { encoding: "utf8", mode: 0o600 },
  );
  await rm(destination, { recursive: true, force: true });
  await rename(temporary, destination);
}
