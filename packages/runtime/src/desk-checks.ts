/**
 * The checks the runtime runs on the person's files in the desk folder, written out by hand: a JSON
 * Schema validator compiles code at run time, which the webview's CSP refuses. They say what
 * `specs/init/v0/profile.schema.json` and `keys.schema.json` say, and desk-yaml.test.ts holds them to
 * the spec's vectors. Each problem names where it is, as a path into the parsed data.
 */
import type { KeysFile, ProfileFile } from "@endue-ai/bridge";

export interface Problem {
  /** Keys and indexes from the top of the file to what is wrong. */
  path: Array<string | number>;
  message: string;
}

declare const checked: unique symbol;
/** A check of one file's data; `T` is the type the data has when there is no problem. */
export type Check<T> = ((value: unknown) => Problem[]) & { readonly [checked]?: T };

type Path = Problem["path"];

const PLUGIN_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const SETTING = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const COMBO = /^((Mod|Meta|Control|Ctrl|Alt|Shift)\+)*([^+\s]+|\+)$/;
const COMMAND = /^$|^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
/** The format version this desk reads. */
export const FILE_VERSION = 0;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Problems with a mapping's keys: only `known` may appear. */
function keysOf(
  value: Record<string, unknown>,
  known: string[],
  at: Path,
  what: string,
): Problem[] {
  return Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => ({
      path: [...at, key],
      message: `${key} is not a key of ${what} (${known.join(", ")})`,
    }));
}

function version(value: unknown): Problem[] {
  if (value === undefined) return [];
  if (!Number.isInteger(value) || (value as number) < 0)
    return [{ path: ["version"], message: "version is a whole number (0)" }];
  if ((value as number) > FILE_VERSION)
    return [
      {
        path: ["version"],
        message: `version ${value} is newer than this Desk reads (${FILE_VERSION}); update Desk`,
      },
    ];
  return [];
}

function text(value: unknown, at: Path, name: string, nonEmpty = false): Problem[] {
  if (value === undefined) return [];
  if (typeof value !== "string" || (nonEmpty && value === ""))
    return [{ path: at, message: `${name} is ${nonEmpty ? "a non-empty" : "a"} string` }];
  return [];
}

function matching(value: unknown, at: Path, pattern: RegExp, max: number, what: string): Problem[] {
  return typeof value === "string" && value.length <= max && pattern.test(value)
    ? []
    : [{ path: at, message: `${JSON.stringify(value)} is not ${what}` }];
}

function pluginList(value: unknown, at: Path): Problem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    return [{ path: at, message: `${at.join("/")} is a list of plugin ids` }];
  const problems = value.flatMap((id, i) =>
    matching(id, [...at, i], PLUGIN_ID, 128, "a plugin id (lowercase, dotted: endue.notes)"),
  );
  value.forEach((id, i) => {
    if (value.indexOf(id) !== i)
      problems.push({ path: [...at, i], message: `${id} is listed twice` });
  });
  return problems;
}

/** A profile file's data, as `ProfileFile` in specs/init/v0/profile.schema.json says. */
export const checkProfileFile: Check<ProfileFile> = (value) => {
  if (!isRecord(value)) return [{ path: [], message: "a profile file is a mapping of keys" }];
  const problems = keysOf(
    value,
    ["version", "name", "description", "plugins", "settings"],
    [],
    "a profile",
  );
  problems.push(...version(value.version));
  problems.push(...text(value.name, ["name"], "name", true));
  problems.push(...text(value.description, ["description"], "description"));
  const { plugins, settings } = value;
  if (plugins !== undefined) {
    if (!isRecord(plugins)) problems.push({ path: ["plugins"], message: "plugins is a mapping" });
    else {
      problems.push(...keysOf(plugins, ["enabled", "disabled"], ["plugins"], "plugins"));
      problems.push(...pluginList(plugins.enabled, ["plugins", "enabled"]));
      problems.push(...pluginList(plugins.disabled, ["plugins", "disabled"]));
    }
  }
  if (settings !== undefined) {
    if (!isRecord(settings))
      problems.push({ path: ["settings"], message: "settings is a mapping" });
    else
      for (const key of Object.keys(settings))
        problems.push(
          ...matching(key, ["settings", key], SETTING, 128, "a setting name (lowercase, dotted)"),
        );
  }
  return problems;
};

function binding(value: unknown, at: Path): Problem[] {
  if (!isRecord(value)) return [{ path: at, message: "a binding is a mapping: key, command" }];
  const problems = keysOf(value, ["key", "mac", "command", "args"], at, "a binding");
  if (value.key === undefined) problems.push({ path: at, message: "a binding needs a key" });
  else
    problems.push(...matching(value.key, [...at, "key"], COMBO, 64, "a key (Mod+K, Mod+Shift+P)"));
  if (value.mac !== undefined)
    problems.push(...matching(value.mac, [...at, "mac"], COMBO, 64, "a key (Meta+K)"));
  if (value.command === undefined)
    problems.push({ path: at, message: 'a binding needs a command ("" takes the key away)' });
  else
    problems.push(
      ...matching(
        value.command,
        [...at, "command"],
        COMMAND,
        128,
        'a command id (desk.palette.open) or ""',
      ),
    );
  return problems;
}

/** keys.yaml's data, as `KeysFile` in specs/init/v0/keys.schema.json says. */
export const checkKeysFile: Check<KeysFile> = (value) => {
  if (!isRecord(value))
    return [{ path: [], message: "keys.yaml is a mapping with a bindings list" }];
  const problems = keysOf(value, ["version", "bindings"], [], "keys.yaml");
  problems.push(...version(value.version));
  const { bindings } = value;
  if (bindings !== undefined) {
    if (!Array.isArray(bindings))
      problems.push({ path: ["bindings"], message: "bindings is a list" });
    else problems.push(...bindings.flatMap((b, i) => binding(b, ["bindings", i])));
  }
  return problems;
};
