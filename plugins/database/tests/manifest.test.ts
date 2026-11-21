import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { candidates } from "../ui/clients.js";
import { createDropped } from "../ui/dropped.js";
import { EXPORT_FOLDER, exportResult } from "../ui/export.js";
import { createRunner } from "../ui/run.js";
import { DEFAULTS, SETTING_KEYS } from "../ui/settings.js";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/database");
const pluginSpec = join(root, "specs/plugin/v0");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  // The manifest references the item, view and connector specs, which reference it back.
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(pluginSpec, "../..", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

/** Every file under a folder, recursively. */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

const readme = () => readFileSync(join(folder, "README.md"), "utf8");
const features = join(folder, "docs/features.md");

/** A permission as a manifest declares it, or as the code asks for it. */
type Scope = { permission: string; commands?: string[]; paths?: string[]; ids?: string[] };
const declarations = () => manifest().permissions as Scope[];
const values = (scope: Scope) => scope.commands ?? scope.paths ?? scope.ids ?? [];

/** `~` and `${home}` are one root, as the core reads them. */
const homed = (path: string) => path.replace(/^\$\{home\}(?=\/|$)/u, "~");
/** Whether a declared path covers an asked one: `/**` any rooted path, `<folder>/**` under it. */
const under = (declared: string, asked: string) => {
  const [d, a] = [homed(declared), homed(asked)];
  if (d === "/**") return /^(?:\/|~(?:\/|$)|[A-Za-z]:\/)/u.test(a);
  if (!d.endsWith("/**")) return d === a;
  const folder = d.slice(0, -3);
  return a === folder || a.startsWith(`${folder}/`);
};
/** ADR 0260's rule for the kinds this plugin declares: a program by its name or `*`, a path under
 * a declared one, a command by its id. */
const covers = (declared: Scope, asked: Scope) => {
  if (declared.permission !== asked.permission) return false;
  if (declared.commands) {
    const any = declared.commands.includes("*");
    return (asked.commands ?? []).every((c) => any || declared.commands?.includes(c));
  }
  if (declared.paths)
    return (asked.paths ?? []).every((a) => declared.paths?.some((d) => under(d, a)));
  return (asked.ids ?? []).every((id) => declared.ids?.includes(id));
};
const coveredBy = (asked: Scope) => declarations().filter((d) => covers(d, asked));

/** A bridge that refuses every call and every ask, keeping what was asked for. */
function refusing() {
  const asked: Scope[] = [];
  const bridge = {
    call: async (method: string, params: { permission?: Scope }) => {
      if (method !== "perm.request")
        throw Object.assign(new Error("no"), { code: "permission_denied" });
      if (params.permission) asked.push(params.permission);
      return { granted: false };
    },
    onEvent: () => () => {},
  };
  return { asked, bridge: bridge as never };
}

describe("plugin.json", () => {
  it("is a UI plugin with one center surface", () => {
    const validate = manifestValidator();
    const db = manifest();
    expect(validate(db), JSON.stringify(validate.errors)).toBe(true);
    expect(db).toMatchObject({
      id: "endue.database",
      name: "Database",
      kind: "ui",
      entry: "ui/index.html",
    });
    expect(existsSync(join(folder, db.entry ?? "missing"))).toBe(true);
    expect(db.surfaces).toEqual([{ id: "main", title: "Database", placement: "center" }]);
  });

  it("contributes every operation as a command, one key, SQLite files and the settings the code reads", () => {
    const { contributes } = manifest();
    const ids = contributes?.commands?.map((c) => c.id) ?? [];
    expect(ids).toHaveLength(37);
    for (const command of contributes?.commands ?? []) {
      expect(command.id).toMatch(/^endue\.database\.[a-z-]+$/u);
      expect(command.title).toMatch(/^Database: /u);
    }
    // The built-in commands, the agents' and each feature's (ui/features/<name>/).
    const source = [
      ...["ui/commands.js", "ui/agent.js"].map((file) => join(folder, file)),
      ...files(join(folder, "ui/features")).filter((path) => path.endsWith(".js")),
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    for (const id of ids) expect(source, id).toContain(`"${id}"`);
    expect(contributes?.keys).toEqual([{ key: "Mod+Shift+B", command: "endue.database.open" }]);
    expect(contributes?.files?.map((f) => f.pattern)).toEqual(["*.sqlite", "*.sqlite3", "*.db3"]);
    expect(Object.keys(contributes?.settings ?? {})).toEqual(SETTING_KEYS);
  });

  it("keeps every source and document under 400 lines and the README under 40", () => {
    const docs = existsSync(join(folder, "docs")) ? files(join(folder, "docs")) : [];
    for (const path of [...files(join(folder, "ui")), ...files(join(folder, "tests")), ...docs]) {
      const text = readFileSync(path, "utf8");
      const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      expect(lines, path).toBeLessThanOrEqual(400);
    }
    expect(readme().trimEnd().split("\n").length).toBeLessThanOrEqual(40);
  });

  it("imports the SDK only in main.js, so every other module runs under the tests", () => {
    for (const path of files(join(folder, "ui")).filter(
      (p) => p.endsWith(".js") && !p.endsWith("main.js"),
    ))
      expect(readFileSync(path, "utf8"), path).not.toMatch(/from "@endue-ai\/plugin-sdk"/u);
  });
});

describe("permissions", () => {
  it("declares only what its code uses, and nothing wider", () => {
    expect(declarations()).toEqual([
      // The engines' clients by name (clients.js, run.js): granted at install.
      { permission: "proc:spawn", commands: ["psql", "mysql", "mariadb", "sqlite3"] },
      // An export (export.js): granted at install.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest's path variable, as written there
      { permission: "fs:write", paths: ["${home}/Downloads/**"] },
      // Ask in the palette, a buffer per console and table, show an export: granted at install.
      {
        permission: "cmd:invoke",
        ids: [
          "desk.palette.pick",
          "desk.buffers.open",
          "desk.buffers.update",
          "desk.buffers.close",
          "desk.files.reveal",
        ],
      },
      // A dropped .sql, .csv, .tsv or .json file anywhere (dropped.js): asked for each file.
      { permission: "fs:read", paths: ["/**"] },
      // The client a setting names by another name or a path (run.js): asked for each program.
      { permission: "proc:spawn", commands: ["*"] },
    ]);
  });

  it("asks at run time only for scopes its declarations cover", async () => {
    // The named programs are each engine's default client; the export folder is export.js's.
    const engines = ["postgresql", "mysql", "sqlite"] as const;
    expect(declarations()[0]?.commands).toEqual(engines.flatMap((e) => candidates(e, DEFAULTS)));
    expect(declarations()[1]?.paths?.map(homed)).toEqual([`${EXPORT_FOLDER}/**`]);
    // The desk commands are the ones the UI runs.
    const source = files(join(folder, "ui"))
      .filter((p) => p.endsWith(".js"))
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    const run = [...source.matchAll(/\.run\(\s*"(desk\.[a-z]+\.[a-z.-]+)"/gu)].map((m) => m[1]);
    expect(new Set(run)).toEqual(new Set(declarations()[2]?.ids));

    // A client set by its path: only `*` covers it, as ADR 0260 matches a program by its name.
    const client = refusing();
    const invocation = { args: [], env: {}, nonce: "", statements: [], maxRows: 0, stopAfter: 0 };
    const runner = createRunner(client.bridge);
    for (const command of ["psql", "/opt/clients/bin/psql"])
      await runner.run({ ...invocation, command }).catch(() => {});
    expect(client.asked).toEqual([
      { permission: "proc:spawn", commands: ["psql"] },
      { permission: "proc:spawn", commands: ["/opt/clients/bin/psql"] },
    ]);
    expect(coveredBy(client.asked[0] as Scope)).toHaveLength(2);
    expect(coveredBy(client.asked[1] as Scope)).toEqual([declarations()[4]]);

    // A dropped file: any root, any letter case; only `/**` covers it.
    const drop = refusing();
    const dropped = createDropped({
      bridge: drop.bridge,
      manager: { get: () => undefined, choose: async () => undefined },
      consoles: { current: () => null, open: async () => undefined },
      importer: { start: async () => {} },
      view: { insert: () => {}, focus: () => {} },
      visit: async () => {},
    });
    for (const path of ["/Volumes/USB/Query.SQL", "C:/Users/me/rows.csv"])
      await dropped({ kind: "file", path }).catch(() => {});
    expect(drop.asked.map((s) => s.paths)).toEqual([
      ["/Volumes/USB/Query.SQL"],
      ["C:/Users/me/rows.csv"],
    ]);
    for (const asked of drop.asked) expect(coveredBy(asked)).toEqual([declarations()[3]]);

    // An export: under the Downloads declaration alone.
    const out = refusing();
    const set = { columns: ["id"], rows: [["1"]], truncated: false };
    await exportResult(out.bridge, { set, format: "csv", name: "orders" }).catch(() => {});
    expect(out.asked).toEqual([{ permission: "fs:write", paths: ["~/Downloads/**"] }]);
    expect(coveredBy(out.asked[0] as Scope)).toEqual([declarations()[1]]);
  });

  it("the README's permission table is the manifest's, one row per declaration", () => {
    const rows = readme()
      .split("\n")
      .filter((line) => /^\| `[a-z]+:[a-z]+`/u.test(line))
      .map((line) =>
        [...(line.split("|")[1] ?? "").matchAll(/`([^`]+)`/gu)].map((m) => m[1]).join(" "),
      );
    const declared = declarations().map((d) => [d.permission, ...values(d)].join(" "));
    expect(rows.sort()).toEqual(declared.sort());
  });

  it("keeps the README to purpose, permissions, commands and tests, and the features in docs/features.md", () => {
    const text = readme();
    expect(text).toContain("docs/features.md");
    expect(text).toContain("`endue.database.*`");
    expect(text).toMatch(/```bash\n[^`]*vitest run plugins\/database/u);
    expect(existsSync(features)).toBe(true);
    const sections = readFileSync(features, "utf8").match(/^## .+$/gmu) ?? [];
    for (const area of [
      "Connections",
      "Explorer",
      "Console",
      "Results",
      "Editing",
      "Import and export",
      "Agents",
    ])
      expect(sections, area).toContain(`## ${area}`);
  });
});
