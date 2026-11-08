// Writing the rendered files into the new plugin folder.

import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** The target folder cannot take a new plugin. */
export class FolderError extends Error {
  override name = "FolderError";
}

/**
 * Write `files` (path relative to the folder → text) into `dir`. The folder must be missing or
 * empty, so nothing of the person's is ever overwritten; missing parents are created.
 */
export async function writePlugin(dir: string, files: Record<string, string>): Promise<void> {
  await assertEmpty(dir);
  for (const [path, text] of Object.entries(files)) {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, { flag: "wx" });
  }
}

async function assertEmpty(dir: string): Promise<void> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!info.isDirectory()) throw new FolderError(`${dir} is not a folder`);
  if ((await readdir(dir)).length > 0) throw new FolderError(`${dir} is not empty`);
}
