// `create-plugin <folder>`: arguments in, a plugin folder and the next commands out.

import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isKind, KINDS, type Kind, type TemplateKind } from "./kinds";
import { checkId, defaultId, defaultName } from "./names";
import { renderPlugin } from "./template";
import { FolderError, writePlugin } from "./write";

const NAMES = Object.keys(KINDS) as TemplateKind[];

export const USAGE = [
  `usage: create-plugin <folder> [--kind ${NAMES.join("|")}] [--id <id>]`,
  "                     [--name <name>] [--description <text>]",
  "",
  "Creates an endue plugin in <folder>, which must be missing or empty, with one test.",
  "",
  "  --kind <kind>         what the plugin is (default: ui):",
  ...NAMES.map((name) => `                          ${name.padEnd(10)} ${KINDS[name].about}`),
  "  --id <id>             manifest id, lowercase reverse-domain (default: local.<folder>)",
  "  --name <name>         display name (default: the folder name as words)",
  "  --description <text>  one sentence about what the plugin does",
].join("\n");

/** Where the command runs and where it reports. */
export interface Io {
  cwd: string;
  out(line: string): void;
  err(line: string): void;
  /** @deprecated The test host resolves its checkout at runtime. */
  desk?: string;
}

/** Run the command. Exit codes, as in `endue`: 0 ok, 1 the folder was not written, 2 usage. */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    return usageError(io, (error as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(USAGE);
    return 0;
  }
  const [folder, ...extra] = positionals;
  if (folder === undefined) return usageError(io, "missing <folder>");
  if (extra.length > 0) return usageError(io, `unexpected argument ${extra.join(" ")}`);

  const kind = values.kind ?? "ui";
  if (!isKind(kind)) return usageError(io, `kind ${kind} is not one of ${NAMES.join(", ")}`);

  const dir = resolve(io.cwd, folder);
  const id = values.id ?? defaultId(basename(dir));
  const idProblem = checkId(id);
  if (idProblem) return usageError(io, idProblem);
  const name = values.name ?? defaultName(basename(dir));
  if (name.trim() === "") return usageError(io, "name is empty");

  try {
    await writePlugin(dir, renderPlugin({ id, name, description: values.description, kind }));
  } catch (error) {
    const reason =
      error instanceof FolderError ? error.message : "could not write the plugin folder";
    io.err(`create-plugin: ${reason}`);
    return 1;
  }

  io.out(`Created ${id}.`);
  io.out("Run these commands from the new plugin folder.");
  const { build, dev, after }: Kind = KINDS[kind];
  if (build) {
    io.out("  rustup target add wasm32-wasip2");
    io.out("  cargo build --release");
  }
  io.out("  endue plugin validate .");
  io.out("  endue plugin test .");
  if (dev) {
    io.out("To launch the dev app, set DESK_REPO to your endue checkout and run:");
    io.out('  DESK_DEV_PLUGINS="$PWD" just --justfile "$DESK_REPO/justfile" dev');
  }
  for (const line of after?.(id) ?? []) io.out(line);
  if (values.id === undefined) {
    io.out("");
    io.out(`Change the id in plugin.json to a reverse-domain id you own before you publish.`);
  }
  return 0;
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      kind: { type: "string" },
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}

function usageError(io: Io, message: string): number {
  io.err(`create-plugin: ${message}`);
  io.err("");
  io.err(USAGE);
  return 2;
}
