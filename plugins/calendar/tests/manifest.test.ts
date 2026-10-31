import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { opener } from "../../../packages/runtime/src/policies/files";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/calendar");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  // The manifest references the item, view and connector specs, which reference it back.
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest's path root, not a placeholder
const CALENDAR = "${home}/Calendar/**";

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

describe("plugin.json", () => {
  it("is a UI plugin that opens iCalendar files and asks only for what it uses", () => {
    const validate = manifestValidator();
    const calendar = manifest();
    expect(validate(calendar), JSON.stringify(validate.errors)).toBe(true);
    expect(calendar).toMatchObject({ id: "endue.calendar", name: "Calendar", kind: "ui" });
    expect(existsSync(join(folder, calendar.entry ?? "missing"))).toBe(true);
    expect(calendar.surfaces).toEqual([{ id: "main", title: "Calendar", placement: "center" }]);
    expect(calendar.permissions).toEqual([
      { permission: "fs:read", paths: [CALENDAR] },
      { permission: "fs:write", paths: [CALENDAR] },
      {
        permission: "cmd:invoke",
        ids: ["desk.files.changed", "desk.files.open", "desk.buffers.update", "desk.palette.pick"],
      },
      { permission: "ui:notify" },
    ]);
  });

  it("the desk's opener rule picks the calendar for .ics, .ical and .ifb", () => {
    const owner = "endue.calendar";
    const rules = (manifest().contributes?.files ?? []).map((rule) => ({ ...rule, owner }));
    expect(opener(rules, "~/Downloads/invite.ics")).toBe("endue.calendar");
    expect(opener(rules, "~/Calendar/team.ical")).toBe("endue.calendar");
    expect(opener(rules, "~/free.ifb")).toBe("endue.calendar");
    expect(opener(rules, "~/notes.md")).toBeUndefined();
  });

  it("every command it contributes is answered by its code, and its settings are its own", () => {
    const contributes = manifest().contributes ?? {};
    const source = readdirSync(join(folder, "ui"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(folder, "ui", f), "utf8"))
      .join("\n");
    for (const { id } of contributes.commands ?? []) {
      const short = id.replace("endue.calendar.", "");
      const answered =
        source.includes(`"${id}"`) ||
        (["month", "week", "day", "agenda"].includes(short) &&
          source.includes("for (const each of MODES) answer("));
      expect(answered, id).toBe(true);
    }
    expect(contributes.keys).toEqual([{ key: "Mod+Shift+C", command: "endue.calendar.open" }]);
    for (const key of Object.keys(contributes.settings ?? {})) {
      expect(key.startsWith("endue.calendar.")).toBe(true);
      expect(source).toMatch(new RegExp(`setting\\("${key.replace("endue.calendar.", "")}"`));
    }
  });
});
