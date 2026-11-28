// Put an explicitly chosen UI plugin in the user folder Desk already reads at startup.
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { checkId } from "./names";

export function localPluginsDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  const base =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? join(home, "AppData", "Roaming"))
        : (process.env.XDG_DATA_HOME ?? join(home, ".local", "share"));
  return join(base, "ai.endue.desktop", "plugins");
}

const omitted = new Set([".git", ".env", "node_modules"]);
const skip = (name: string) => omitted.has(name) || name.startsWith(".env.");

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export async function installLocalUi(source: string, plugins: string): Promise<string> {
  const folder = await realpath(source);
  const { id, kind, entry } = JSON.parse(await readFile(join(folder, "plugin.json"), "utf8"));
  if (typeof id !== "string" || !id.startsWith("local.") || checkId(id) || kind !== "ui") {
    throw new Error("Choose a UI plugin with a valid local.* id in plugin.json.");
  }
  if (
    typeof entry !== "string" ||
    entry.includes("\\") ||
    entry.includes(":") ||
    entry.split("/").some((part) => !part || part === "." || part === ".." || skip(part))
  ) {
    throw new Error("Set entry to a page inside the plugin folder.");
  }
  if (contains(folder, plugins))
    throw new Error("Choose a source folder outside the Desk plugins directory.");
  await mkdir(plugins, { recursive: true });
  const root = await realpath(plugins);
  if (contains(folder, root) || contains(root, folder)) {
    throw new Error("Choose a source folder outside the Desk plugins directory.");
  }
  const destination = join(root, id);
  const staging = await mkdtemp(join(root, ".create-plugin-"));
  const copy = join(staging, "plugin");
  try {
    await cp(folder, copy, {
      recursive: true,
      filter: async (path) => {
        if (path !== folder && skip(basename(path))) return false;
        const info = await lstat(path);
        if (info.isFile() || info.isDirectory()) return true;
        throw new Error(`Replace ${relative(folder, path)} with a regular file or folder.`);
      },
    });
    if (!(await lstat(join(copy, entry)).catch(() => null))?.isFile()) {
      throw new Error(`The entry page ${entry} is missing.`);
    }
    if (
      !(await readFile(join(copy, "plugin.json"), "utf8").then((text) => {
        const staged = JSON.parse(text);
        return staged.id === id && staged.kind === kind && staged.entry === entry;
      }))
    ) {
      throw new Error("The manifest changed during installation. Run install again.");
    }
    for (const name of await readdir(root)) {
      if (name === id) throw new Error(`A plugin folder at ${destination} already exists.`);
      if (name.startsWith(".")) continue;
      const installed: unknown = await readFile(join(root, name, "plugin.json"), "utf8")
        .then((text) => JSON.parse(text)?.id)
        .catch(() => undefined);
      if (installed === id) throw new Error(`Plugin ${id} is already installed in ${name}.`);
    }
    // Nonempty installs landing concurrently at this id make rename fail on every supported OS.
    await rename(copy, destination);
    return destination;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
