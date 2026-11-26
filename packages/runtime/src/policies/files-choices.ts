// File grants that follow a choice the desk can tie to a specific path or open buffer.
import type { Buffer, Buffers } from "../buffers";
import { CommandError, type Commands } from "../commands";
import type { DeskContext } from "./context";
import { folderRead, onePath } from "./files-open";

const ERIS = "endue.eris";
const PLAYER = "endue.player";
const CALENDAR = "endue.calendar";
const SHEETS = "endue.sheets";
const TEXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|yaml|yml|xml|html|css|js|ts|jsx|tsx|rs|py|sh|toml|ini|cfg|sql|log|c|h|cpp|java|go|rb|php|svelte|vue)$/i;

/** A literal file name that can safely be used in a path scope. */
export function literalFile(path: string): string | undefined {
  if (/[\\*?]/.test(path) || path.includes("\0")) return undefined;
  const normalized = onePath(path);
  if (!/^(?:~\/|\/(?!\/)|[A-Za-z]:\/).+/.test(normalized)) return undefined;
  if (normalized.split("/").includes("..")) return undefined;
  return normalized;
}

export async function pickFileChoice(
  commands: Commands,
  title: string,
  items: unknown[],
  free = false,
) {
  if (!commands.has("desk.palette.pick")) return undefined;
  const answer = await commands
    .run("desk.palette.pick", { title, items, free, placeholder: free ? "~/path/to/file" : "" })
    .catch(() => undefined);
  return typeof answer === "string" ? answer : undefined;
}

const grantFiles = (
  ctx: DeskContext,
  caller: string,
  permission: "fs:read" | "fs:write",
  paths: string[],
  reason: string,
) =>
  ctx.bridge.call("perm.grant", {
    caller,
    permission: { permission, paths },
    duration: "session",
    reason,
    scope: { permission: "perm:manage" },
  });

export function installFileChoices(ctx: DeskContext, files: Buffers) {
  const { hub } = ctx;
  const chosen = new Map<string, string>();
  const builtIn = (id: string) => hub.plugins.some((plugin) => plugin.id === id && plugin.builtIn);

  const bindings = [
    hub.commands.define("desk.files.attach", {
      title: "Choose an open file to attach",
      owner: "desk.files",
      async run(_args, { caller }) {
        if (caller !== ERIS || !builtIn(ERIS))
          throw new CommandError("failed", "Only Eris can ask for this attachment");
        const candidates = files
          .list()
          .filter((file) => file.path && TEXT.test(file.path) && literalFile(file.path));
        if (!candidates.length) throw new Error("Open a text file first, then attach it here.");
        const choice = await hub.commands.run("desk.palette.pick", {
          title: "Attach the saved text of an open file",
          items: candidates.map((file) => ({
            id: file.id,
            label: file.name,
            detail: file.path + (file.modified ? " · unsaved changes are excluded" : ""),
          })),
        });
        if (typeof choice !== "string") return null;
        const selected = candidates.find((candidate) => candidate.id === choice);
        const current = files.get(choice);
        if (!selected?.path || !current || current.path !== selected.path) return null;
        const path = literalFile(selected.path);
        if (!path) return null;
        await grantFiles(ctx, ERIS, "fs:read", [path], "The person chose this attachment");
        return { path, modified: current.modified };
      },
    }),
    hub.commands.define("desk.files.playlist-entries", {
      title: "Read the entries of the selected playlist",
      owner: "desk.files",
      async run(args, { caller }) {
        if (caller !== PLAYER || !builtIn(PLAYER)) return false;
        const { buffer, paths } = (args ?? {}) as { buffer?: unknown; paths?: unknown };
        if (typeof buffer !== "string" || !Array.isArray(paths)) return false;
        const file = files.get(buffer);
        if (file?.plugin !== PLAYER || !file.path || chosen.get(buffer) !== file.path) return false;
        const folders = new Set<string>();
        for (const value of paths.slice(0, 1000)) {
          const path = typeof value === "string" && literalFile(value);
          if (path) folders.add(folderRead(path).paths[0] ?? path);
        }
        if (folders.size)
          await grantFiles(ctx, PLAYER, "fs:read", [...folders], "The person opened this playlist");
        return true;
      },
    }),
  ];
  return {
    close: (id: string) => chosen.delete(id),
    async read(plugin: string, path: string, id: string) {
      if (!literalFile(path)) return;
      chosen.set(id, path);
      await grantFiles(
        ctx,
        plugin,
        "fs:read",
        folderRead(path).paths,
        "The person opened this file",
      ).catch(() => undefined);
    },
    async save(buffer: Buffer & { path: string }, caller?: string) {
      if (caller?.startsWith("agent:") && buffer.plugin === CALENDAR && builtIn(CALENDAR))
        throw new CommandError("failed", "Use endue.calendar.save for this Calendar buffer");
      if (caller?.startsWith("agent:") && buffer.plugin === SHEETS && builtIn(SHEETS))
        throw new CommandError("failed", "Use endue.sheets.save with this worksheet's path");
      if (caller === undefined && chosen.get(buffer.id) === buffer.path)
        await grantFiles(
          ctx,
          buffer.plugin,
          "fs:write",
          [buffer.path],
          "The person saved this file",
        ).catch(() => undefined);
    },
    dispose() {
      for (const off of bindings) off();
      chosen.clear();
    },
  };
}
