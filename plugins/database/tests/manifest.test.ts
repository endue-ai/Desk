import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { candidates, PROGRAMS, programCandidates } from "../ui/clients.js";
import { blank } from "../ui/connections.js";
import { writeScope } from "../ui/console-files.js";
import { spillPath } from "../ui/console-text.js";
import { createDropped } from "../ui/dropped.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { EXPORT_FOLDER, exportResult } from "../ui/export.js";
import { createRunner } from "../ui/run.js";
import { DEFAULTS, fromValues, SETTING_KEYS } from "../ui/settings.js";
import { CHOICES, RANGES, STYLE } from "../ui/sql/layout/style.js";
import { split } from "../ui/sql/split.js";

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
type Scope = {
  permission: string;
  commands?: string[];
  paths?: string[];
  ids?: string[];
  hosts?: string[];
};
const declarations = () => manifest().permissions as Scope[];
const values = (scope: Scope) => scope.commands ?? scope.paths ?? scope.ids ?? scope.hosts ?? [];

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
  if (declared.hosts) return declared.hosts.includes("*");
  return (asked.ids ?? []).every((id) => declared.ids?.includes(id));
};
const coveredBy = (asked: Scope) => declarations().filter((d) => covers(d, asked));

/** A bridge that refuses every call and every ask, keeping what was asked for. */
function refusing(answers: Record<string, () => unknown> = {}) {
  const asked: Scope[] = [];
  const bridge = {
    call: async (method: string, params: { permission?: Scope }) => {
      const answer = answers[method];
      if (answer) return answer();
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
    expect(ids).toHaveLength(205);
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
    expect(contributes?.files?.map((f) => f.pattern)).toEqual([
      "*.sqlite",
      "*.sqlite3",
      "*.db3",
      "*.sql",
    ]);
    expect(Object.keys(contributes?.settings ?? {})).toEqual(SETTING_KEYS);
    // Format SQL's style (ADR 0292): each choice and range the code takes is the manifest's.
    const declared = contributes?.settings ?? {};
    for (const [field, choices] of Object.entries(CHOICES)) {
      const key = `endue.database.format-${field.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)}`;
      expect([key, declared[key]?.choices, declared[key]?.default]).toEqual([
        key,
        choices,
        choices[0],
      ]);
    }
    for (const [field, [minimum, maximum]] of Object.entries(RANGES)) {
      const key = `endue.database.format-${field.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)}`;
      expect(declared[key]).toMatchObject({ kind: "integer", minimum, maximum });
      expect(declared[key]?.default).toBe(STYLE[field as keyof typeof RANGES]);
    }
  });

  it("declares each setting's default, range and choices as settings.js checks them", () => {
    const declared = manifest().contributes?.settings ?? {};
    for (const key of SETTING_KEYS) {
      const setting = declared[key];
      const name = key
        .slice("endue.database.".length)
        .replace(/-([a-z0-9])/gu, (_, c: string) => c.toUpperCase()) as keyof typeof DEFAULTS;
      expect([key, setting?.default]).toEqual([key, DEFAULTS[name]]);
      const keeps = (value: unknown) => fromValues({ [key]: value })[name] === value;
      if (setting?.kind === "integer") {
        const { minimum, maximum } = setting;
        expect([key, typeof minimum, typeof maximum]).toEqual([key, "number", "number"]);
        const bounds = [minimum, maximum, Number(minimum) - 1, Number(maximum) + 1].map(keeps);
        expect([key, ...bounds]).toEqual([key, true, true, false, false]);
      } else if (setting?.choices) {
        expect([key, ...setting.choices.map(keeps), keeps("none of them")]).toEqual([
          key,
          ...setting.choices.map(() => true),
          false,
        ]);
      } else {
        expect([key, setting?.minimum, setting?.maximum]).toEqual([key, undefined, undefined]);
      }
    }
  });

  it("ships the vendored SQL parser its worker loads, with its licences and pins", () => {
    const vendored =
      "libpg-query.mjs libpg-query.wasm LICENSE LICENSE.libpg_query COPYRIGHT.postgresql";
    for (const name of [...vendored.split(" "), "VERSIONS"])
      expect(existsSync(join(folder, "ui/vendor", name)), name).toBe(true);
    expect(readFileSync(join(folder, "ui/sql/parse/worker.js"), "utf8")).toContain(
      'new URL("../../vendor/libpg-query.wasm", import.meta.url)',
    );
  });

  it("keeps every source and document under 400 lines and the README under 40", () => {
    const docs = existsSync(join(folder, "docs")) ? files(join(folder, "docs")) : [];
    // ui/vendor holds a vendored build as it was published (ADR 0283), not the plugin's source.
    const vendor = join(folder, "ui", "vendor");
    const sources = [...files(join(folder, "ui")), ...files(join(folder, "tests")), ...docs].filter(
      (path) => !path.startsWith(vendor),
    );
    for (const path of sources) {
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
      // The engines' clients and PostgreSQL's pg_dump and pg_restore by name (clients.js, run.js,
      // features/backup/): granted at install. PostgreSQL's statements need no client: its
      // sessions are the core's (db:connect below).
      {
        permission: "proc:spawn",
        commands: ["mysql", "mariadb", "sqlite3", "pg_dump", "pg_restore"],
      },
      // A cell's bytes saved (features/cell-values/): granted at install. An export needs no
      // declaration of its own: the save dialog grants the path the person chooses (export.js).
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
          "desk.files.changed",
        ],
      },
      // A dropped .sql, .csv, .tsv or .json file anywhere (dropped.js): asked for each file.
      { permission: "fs:read", paths: ["/**"] },
      // The client a setting names by another name or a path (run.js): asked for each program.
      // A PostgreSQL connection's password command too, after the person's yes (auth/, ADR 0354).
      { permission: "proc:spawn", commands: ["*"] },
      // Saving a .sql file the person opened, anywhere (console-files.js): asked for each file.
      { permission: "fs:write", paths: ["/**"] },
      // A console's text past the store's limit (console-text.js): granted at install.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest's path variable, as written there
      { permission: "fs:read", paths: ["${home}/.endue/database/**"] },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest's path variable, as written there
      { permission: "fs:write", paths: ["${home}/.endue/database/**"] },
      // A PostgreSQL session on a connection's host and port (engines/pg-session.js, ADR 0281):
      // asked for each server; it also lets the plugin keep that server's password in the
      // keychain (keychain.js, ADR 0311).
      { permission: "db:connect", hosts: ["*"] },
      // Eris's help in a console (features/assist/, ADR 0345): one question at a time through
      // brain.ask, in a session of its own; granted at install.
      { permission: "brain:ask" },
    ]);
  });

  it("asks at run time only for scopes its declarations cover", async () => {
    // The named programs are each engine's default client and the backup's two programs; the
    // Downloads folder is where a cell's bytes go.
    const engines = ["postgresql", "mysql", "sqlite"] as const;
    const programs = Object.keys(PROGRAMS) as Array<keyof typeof PROGRAMS>;
    expect(declarations()[0]?.commands).toEqual([
      ...engines.flatMap((e) => candidates(e, DEFAULTS)),
      ...programs.flatMap((p) => programCandidates(p, DEFAULTS)),
    ]);
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
    for (const command of ["mysql", "/opt/clients/bin/mysql"])
      await runner.run({ ...invocation, command }).catch(() => {});
    expect(client.asked).toEqual([
      { permission: "proc:spawn", commands: ["mysql"] },
      { permission: "proc:spawn", commands: ["/opt/clients/bin/mysql"] },
    ]);
    expect(coveredBy(client.asked[0] as Scope)).toHaveLength(2);
    expect(coveredBy(client.asked[1] as Scope)).toEqual([declarations()[4]]);

    // A dropped file: any root, any letter case; only `/**` covers it.
    const drop = refusing();
    const dropped = createDropped({
      bridge: drop.bridge,
      manager: { get: () => undefined, choose: async () => undefined },
      consoles: { current: () => null, open: async () => undefined },
      files: { open: async () => undefined },
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

    // A PostgreSQL server: its host and port, only db:connect on `*` covers it.
    const pg = refusing();
    const sessions = createSessions(pg.bridge);
    const conn = { ...blank("postgresql"), id: "c-pg", name: "pg", host: "db.example", port: 6543 };
    conn.user = "app";
    const statements = split("select 1", "postgresql");
    const options = { statements, maxRows: 1, timeoutMs: 0, mode: "run" as const };
    await sessions.run(conn, options).catch(() => {});
    expect(pg.asked).toEqual([{ permission: "db:connect", hosts: ["db.example:6543"] }]);
    expect(coveredBy(pg.asked[0] as Scope)).toEqual([declarations()[8]]);

    // Eris's help in a console asks under brain:ask, which its own declaration covers.
    expect(coveredBy({ permission: "brain:ask" })).toEqual([declarations()[9]]);

    // An export: only the path the save dialog answered, which no declaration grants (`/**` only
    // lets it ask), and nothing under ~/Downloads.
    const out = refusing({
      "dialog.save": () => ({ cancelled: false, path: "~/Reports/orders.csv" }),
    });
    const set = { columns: ["id"], rows: [["1"]], truncated: false };
    await exportResult(out.bridge, { set, format: "csv", name: "orders" }).catch(() => {});
    expect(out.asked).toEqual([{ permission: "fs:write", paths: ["~/Reports/orders.csv"] }]);
    expect(coveredBy(out.asked[0] as Scope)).toEqual([declarations()[5]]);

    // A .sql file saved anywhere: only `/**` covers it. A console's long text: the plugin's folder,
    // granted at install, besides `/**`, which only lets it ask.
    const save = {
      permission: "fs:write",
      paths: [writeScope("/Volumes/USB/Q.SQL").paths[0] ?? ""],
    };
    expect(coveredBy(save)).toEqual([declarations()[5]]);
    const spill = spillPath("k-0123456789");
    expect(spill).toMatch(/^~\/\.endue\/database\//u);
    expect(coveredBy({ permission: "fs:write", paths: [spill] })).toEqual([
      declarations()[5],
      declarations()[7],
    ]);
    expect(coveredBy({ permission: "fs:read", paths: [spill] })).toEqual([
      declarations()[3],
      declarations()[6],
    ]);
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
