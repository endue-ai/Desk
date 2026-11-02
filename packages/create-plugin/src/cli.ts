// `create-plugin <folder>`: arguments in, a plugin folder and the next commands out.

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { checkId, defaultId, defaultName } from "./names";
import { renderPlugin, type TemplateKind } from "./template";
import { writePlugin } from "./write";

const KINDS: readonly TemplateKind[] = ["ui", "connector", "theme"];

export const USAGE = `usage: create-plugin <folder> [--kind ui|connector|theme] [--id <id>] [--name <name>]
                     [--description <text>]

Creates a Desk plugin in <folder>, which must be missing or empty: a UI plugin, with
--kind connector a Wasm connector in Rust, or with --kind theme a theme.

  --kind <kind>         ui (default), connector or theme
  --id <id>             manifest id, lowercase reverse-domain (default: local.<folder>)
  --name <name>         display name (default: the folder name as words)
  --description <text>  one sentence about what the plugin does`;

/** Where the command runs and where it reports. */
export interface Io {
  cwd: string;
  out(line: string): void;
  err(line: string): void;
  /** The Desk repository the command runs from, when it knows; a theme's test imports from it. */
  desk?: string;
}

/** Run the command. Exit codes, as in `desk`: 0 ok, 1 the folder was not written, 2 usage. */
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

  const kind = (values.kind ?? "ui") as TemplateKind;
  if (!KINDS.includes(kind)) return usageError(io, `kind ${kind} is not ui, connector or theme`);

  const dir = resolve(io.cwd, folder);
  const id = values.id ?? defaultId(basename(dir));
  const idProblem = checkId(id);
  if (idProblem) return usageError(io, idProblem);
  const name = values.name ?? defaultName(basename(dir));
  if (name.trim() === "") return usageError(io, "name is empty");

  const desk =
    io.desk === undefined ? undefined : relative(real(dir), real(io.desk)).split(sep).join("/");
  try {
    const options = { id, name, description: values.description, kind, desk };
    await writePlugin(dir, renderPlugin(options));
  } catch (error) {
    io.err(`create-plugin: ${(error as Error).message}`);
    return 1;
  }

  io.out(`Created ${id} in ${dir}`);
  io.out("");
  if (kind === "connector") {
    io.out("Next, build the component:");
    io.out("  rustup target add wasm32-wasip2");
    io.out(`  cd ${shellQuote(dir)} && cargo build --release`);
    io.out("Then, from the Desk repository:");
    io.out(`  cargo run -p desk-cli -- plugin validate ${shellQuote(dir)}`);
  } else if (kind === "theme") {
    io.out("Next, from the Desk repository:");
    io.out(`  cargo run -p desk-cli -- plugin validate ${shellQuote(dir)}`);
    io.out(`  pnpm exec vitest run --root ${shellQuote(dir)}`);
    io.out(`  DESK_DEV_PLUGINS=${shellQuote(dir)} just dev`);
    io.out("Then choose it in the theme studio, or with:");
    io.out(`  cargo run -p desk-cli -- theme apply ${id}`);
  } else {
    io.out("Next, from the Desk repository:");
    io.out(`  cargo run -p desk-cli -- plugin validate ${shellQuote(dir)}`);
    io.out(`  DESK_DEV_PLUGINS=${shellQuote(dir)} just dev`);
  }
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

/**
 * `path` with its links resolved, as the test that imports through it will see it (macOS's /tmp is
 * /private/tmp); the part that does not exist yet is kept as it is.
 */
function real(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(real(parent), basename(path));
}

/** `text` as one shell word: unchanged when it is safe, single-quoted otherwise. */
function shellQuote(text: string): string {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}
