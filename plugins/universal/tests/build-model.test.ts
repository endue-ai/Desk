import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  fieldsOf,
  idFor,
  inputOf,
  ROLES,
  SHAPES,
  sourceOf,
  suggestMap,
  viewOf,
} from "../ui/build-model.js";
import { folderData, sizeOf } from "../ui/folder.js";

// The view builder's model (ADR 0102): fields, roles, suggested mappings, the view it makes, and the
// folder source, without a DOM.
const specs = join(import.meta.dirname, "../../../specs");
const read = (path: string) => JSON.parse(readFileSync(join(specs, path), "utf8")) as object;
function universal() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const file of [
    "view/v0/universal.schema.json",
    "view/v0/view.schema.json",
    "item/v0/item.schema.json",
    "item/v0/query.schema.json",
    "plugin/v0/plugin.schema.json",
    "plugin/v0/contributes.schema.json",
    "plugin/v0/permission.schema.json",
    "plugin/v0/theme.schema.json",
    "plugin/v0/design-system.schema.json",
  ])
    ajv.addSchema(read(file));
  const validate = ajv.getSchema(
    "https://endue.ai/specs/view/v0/universal.schema.json#/$defs/UniversalView",
  );
  if (!validate) throw new Error("cannot compile UniversalView");
  return validate;
}

const LAUNCH = {
  title: "Launch",
  entries: [
    { id: "a", name: "Write the post", column: "doing", due: "2026-11-02", owner: "Mira" },
    { id: "b", name: "Record the demo", column: "todo", due: "2026-11-04" },
    { id: "c", name: "Ship", column: "todo" },
  ],
};

describe("the builder's model", () => {
  it("lists the fields of the entries, the most common first", () => {
    expect(fieldsOf(LAUNCH)).toEqual(["column", "id", "name", "due", "owner"]);
    expect(fieldsOf(null)).toEqual([]);
  });

  it("draws the roles each shape needs, the most telling first", () => {
    expect(SHAPES.map((s) => s.type)).toEqual([
      "list",
      "kanban",
      "timeline",
      "calendar",
      "text",
      "chat",
      "agent",
    ]);
    expect(ROLES.kanban.slice(0, 2)).toEqual(["title", "group"]);
    expect(ROLES.timeline.slice(0, 2)).toEqual(["title", "start"]);
    expect(ROLES.chat[0]).toBe("author");
  });

  it("suggests which field plays a role by its name, and a dated field for start", () => {
    expect(suggestMap(LAUNCH)).toEqual({
      title: "name",
      start: "due",
      group: "column",
      author: "owner",
    });
    // A role a field already has by name, or the data's own map, is left alone.
    expect(
      suggestMap({ entries: [{ title: "x", status: "done" }], map: { group: "status" } }),
    ).toEqual({});
    expect(suggestMap({ entries: [{ title: "x", shipped: "2026-10-30T09:00:00+09:00" }] })).toEqual(
      {
        start: "shipped",
      },
    );
  });

  it("makes a view the universal schema accepts, its type first in every shape", () => {
    const validate = universal();
    const view = viewOf({
      title: " Launch board ",
      type: "kanban",
      source: { file: "~/boards/launch.yaml" },
      map: { title: "name", group: "column", detail: "" },
    });
    expect(view).toEqual({
      title: "Launch board",
      type: "kanban",
      types: ["kanban", "list", "timeline", "calendar", "text", "chat", "agent"],
      source: { file: "~/boards/launch.yaml" },
      map: { title: "name", group: "column" },
    });
    expect(validate({ ...view, id: idFor("Launch board") }), JSON.stringify(validate.errors)).toBe(
      true,
    );
  });

  it("switching the shape keeps the source and the map", () => {
    const state = {
      title: "Launch",
      type: "kanban" as const,
      source: { file: "~/boards/launch.yaml" },
      map: { title: "name", group: "column", start: "due" },
    };
    const board = viewOf(state);
    const timeline = viewOf({ ...state, type: "timeline" });
    expect(timeline.source).toEqual(board.source);
    expect(timeline.map).toEqual(board.map);
    expect(timeline.type).toBe("timeline");
    expect(timeline.types?.[0]).toBe("timeline");
  });

  it("reads the source from the inputs, says what is wrong, and fills the inputs back from a source", () => {
    expect(sourceOf({ kind: "file", path: " ~/boards/launch.yaml " })).toEqual({
      source: { file: "~/boards/launch.yaml" },
    });
    expect(sourceOf({ kind: "file", path: "boards/launch.yaml" })).toHaveProperty("problem");
    expect(sourceOf({ kind: "url", url: "ftp://x" })).toHaveProperty("problem");
    expect(
      sourceOf({ kind: "command", command: "desk.universal.folder", args: '{"path":"~/n"}' }),
    ).toEqual({ source: { command: "desk.universal.folder", args: { path: "~/n" } } });
    expect(sourceOf({ kind: "command", command: "x.y", args: "[1]" })).toHaveProperty("problem");
    expect(sourceOf({ kind: "items", kinds: ["task", "bogus"] })).toEqual({
      source: { items: { kinds: ["task"] } },
    });
    expect(sourceOf({ kind: "items" })).toEqual({ source: { items: {} } });
    expect(inputOf({ command: "a.b", args: { n: 1 } })).toEqual({
      kind: "command",
      command: "a.b",
      args: '{"n":1}',
    });
    expect(inputOf({ items: { kinds: ["event"] } })).toEqual({ kind: "items", kinds: ["event"] });
  });

  it("names a new view my.<slug of its title>", () => {
    expect(idFor("Launch board")).toBe("my.launch-board");
    expect(idFor("2026 plans")).toBe("my.view-2026-plans");
    expect(idFor("이번 주")).toBe("my.view");
  });
});

describe("desk.universal.folder", () => {
  it("lists a folder's files and folders newest first, by name, kind and size, hidden ones left out", () => {
    const data = folderData("~/notes/", [
      { name: "old.md", kind: "file", size: 512, modifiedAt: "2026-10-01T09:00:00+09:00" },
      { name: "drafts", kind: "dir", modifiedAt: "2026-10-29T09:00:00+09:00" },
      { name: ".DS_Store", kind: "file", size: 6148 },
      { name: "plan.yaml", kind: "file", size: 2048, modifiedAt: "2026-10-30T08:00:00+09:00" },
    ]);
    expect(data.title).toBe("notes");
    expect(data.entries.map((e) => [e.title, e.group, e.detail])).toEqual([
      ["plan.yaml", "yaml", "2.0 KB"],
      ["drafts", "folder", undefined],
      ["old.md", "md", "512 B"],
    ]);
    expect(data.entries[0]).toMatchObject({ id: "~/notes/plan.yaml", path: "~/notes/plan.yaml" });
    expect(sizeOf(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
