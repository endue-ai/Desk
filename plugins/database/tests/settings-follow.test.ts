// The settings followed while the plugin runs (PG-104): each read through settings.get, a change
// through settings.changed in force at the next run without a reload, what is open redrawn where it
// is safe (the explorer's system schemas), and a value of the wrong kind said once as it falls back.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import type { Deps, Feature } from "../ui/feature-host.js";
import * as builtins from "../ui/features/index.js";
import { SETTING_KEYS } from "../ui/settings.js";
import { type Mounted, mount, SAVED } from "./harness";
import { catalogScript, shop } from "./pg-catalog";

const PREFIX = "endue.database.";
const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
) as PluginManifest;
const declared = manifest.contributes?.settings ?? {};
/** The field settings.js names a key by: `max-rows` is `maxRows`. */
const nameOf = (key: string) =>
  key.slice(PREFIX.length).replace(/-([a-z0-9])/gu, (_, c: string) => c.toUpperCase());

/** A feature that keeps the deps it was given, to read the settings in force. */
function probe() {
  let deps: Deps | undefined;
  const feature: Feature = {
    id: "probe",
    actions: (given) => {
      deps = given;
      return {};
    },
  };
  return { features: [...Object.values(builtins), feature], settings: () => deps?.settings() };
}

const setting = async (m: Mounted, key: string, value: unknown) => {
  await m.host.call("settings.set", { key, value }, "endue.database");
  await m.settle();
};
const runOn = async (m: Mounted, connection: string, sql: string) => {
  await m.host.command("endue.database.console", { connection });
  m.view.text = sql;
  m.view.caret = sql.length;
  await m.host.command("endue.database.run");
  await m.settle();
};
const notices = (m: Mounted) => m.view.said.filter((text) => text.startsWith("The setting "));
const row = (m: Mounted, label: string, kind?: string) =>
  m.view.trees.at(-1)?.find((r) => r.label === label && (!kind || r.kind === kind));
async function until(m: Mounted, test: () => unknown) {
  for (let i = 0; i < 60 && !test(); i++) await m.settle();
  expect(test()).toBeTruthy();
}

/** A value of the setting's kind other than its default, within its range and choices. */
function other(key: string): unknown {
  const setting = declared[key];
  const fallback = setting?.default;
  if (setting?.choices) return setting.choices.find((choice) => choice !== fallback);
  if (setting?.kind === "boolean") return !fallback;
  if (setting?.kind === "integer") {
    const max = setting.maximum ?? 100;
    return fallback === max ? (setting.minimum ?? 0) : max;
  }
  if (setting?.kind === "array") return ["/opt/db/bin"];
  return `/opt/db/bin/${key.slice(PREFIX.length)}`;
}

describe("settings followed while the plugin runs", () => {
  it("reads each setting it declares through settings.get, over init.yaml's", async () => {
    const p = probe();
    const m = await mount({
      store: { connections: SAVED },
      init: { "endue.database.max-rows": 7, "endue.database.history-max": 9 },
      settings: { "max-rows": 2 },
      features: p.features,
    });
    const asked = m.host.calls.filter((c) => c.method === "settings.get").map((c) => c.params);
    expect(asked).toEqual(SETTING_KEYS.map((key) => ({ key: key.slice(PREFIX.length) })));
    expect(p.settings()).toMatchObject({ maxRows: 2, historyMax: 9 });
  });

  it("takes every setting it declares from settings.changed, without a reload", async () => {
    const p = probe();
    const m = await mount({ store: { connections: SAVED }, features: p.features });
    for (const key of SETTING_KEYS) {
      const value = other(key);
      await setting(m, key.slice(PREFIX.length), value);
      const now = p.settings() as Record<string, unknown> | undefined;
      expect([key, now?.[nameOf(key)]]).toEqual([key, value]);
    }
  });

  it("a value of the wrong kind falls back to its default with one notice", async () => {
    const p = probe();
    const m = await mount({
      store: { connections: SAVED },
      init: { "endue.database.max-rows": "lots", "endue.database.path": "/opt/db/bin" },
      features: p.features,
    });
    expect(p.settings()).toMatchObject({ maxRows: 500, path: [] });
    expect(notices(m)).toEqual([
      'The setting endue.database.max-rows is "lots", not a whole number from 1 to 100000, so its default 500 is in force. The setting endue.database.path is "/opt/db/bin", not a list of folders, so its default [] is in force.',
    ]);
    await runOn(m, "Notes", "select 1");
    await setting(m, "confirm", false);
    await m.host.command("endue.database.clients");
    await m.settle();
    expect(notices(m)).toHaveLength(1);

    await setting(m, "history", "yes");
    expect(p.settings()?.history).toBe(true);
    expect(notices(m).at(-1)).toBe(
      'The setting endue.database.history is "yes", not true or false, so its default true is in force.',
    );
    await setting(m, "history", "yes");
    expect(notices(m)).toHaveLength(2);
    const warned = m.host.logged.filter((e) => e.level === "warn").map((e) => e.message);
    expect(warned).toEqual(notices(m));
  });

  it("the core's settings.invalid for one of its keys is said once", async () => {
    const m = await mount({ store: { connections: SAVED } });
    const data = {
      owner: "endue.database",
      key: "max-rows",
      value: 0,
      reason: "0 is less than the minimum 1",
      file: "~/.desk/init.yaml",
      line: 4,
    };
    m.host.emit({ event: "settings.invalid", data });
    await m.settle();
    m.host.emit({ event: "settings.invalid", data });
    m.host.emit({ event: "settings.invalid", data: { ...data, owner: "endue.terminal" } });
    await m.settle();
    expect(notices(m)).toEqual([
      "The setting endue.database.max-rows (init.yaml line 4): 0 is less than the minimum 1, so 500 is in force.",
    ]);
  });

  it("system schemas show and hide in the open explorer at once", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: catalogScript(() => shop()),
      pick: () => "yes",
    });
    await until(m, () => row(m, "Shop"));
    m.app.toggle(row(m, "Shop") as never, true);
    await until(m, () => row(m, "public", "schema"));
    expect(row(m, "pg_catalog", "schema")).toBeUndefined();
    await setting(m, "system-schemas", true);
    await until(m, () => row(m, "pg_catalog", "schema") && row(m, "information_schema", "schema"));
    await setting(m, "system-schemas", false);
    await until(m, () => row(m, "public", "schema") && !row(m, "pg_catalog", "schema"));
  });

  it("a problems setting draws the explorer again, so the editor checks the console again", async () => {
    const m = await mount({ store: { connections: SAVED } });
    for (const key of ["problems-syntax", "problems-names"]) {
      const drawn = m.view.trees.length;
      await setting(m, key, false);
      expect([key, m.view.trees.length]).toEqual([key, drawn + 1]);
    }
  });

  it("the row limit and the statement timeout reach the next PostgreSQL run", async () => {
    const rows = [["n"], ["1"], ["2"], ["3"], ["4"], ["5"]];
    const m = await mount({
      store: { connections: SAVED },
      script: (sql) => (sql === "select n from t" ? { rows } : {}),
    });
    await setting(m, "max-rows", 2);
    await setting(m, "timeout-seconds", 5);
    await runOn(m, "Shop", "select n from t");
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([["1"], ["2"]]);
    const opened = m.host.calls.filter((c) => c.method === "db.open");
    expect(opened.length).toBeGreaterThan(0);
    for (const call of opened)
      expect((call.params as { settings: Record<string, string> }).settings).toMatchObject({
        statement_timeout: "5000",
      });
  });

  it("history and history-max take a change at the next run", async () => {
    const m = await mount({ store: { connections: SAVED } });
    await setting(m, "history", false);
    await runOn(m, "Notes", "select 1");
    expect(m.store["history:c-lite"]).toBeUndefined();
    await setting(m, "history", true);
    await setting(m, "history-max", 1);
    await runOn(m, "Notes", "select 2");
    await runOn(m, "Notes", "select 3");
    const kept = m.store["history:c-lite"] as Array<{ sql: string }>;
    expect(kept.map((entry) => entry.sql)).toEqual(["select 3"]);
  });
});
