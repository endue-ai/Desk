import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  browserStub,
  type Item,
  type ItemQuery,
  type PluginManifest,
  stubCommands,
  type View,
  type ViewComponent,
  type ViewContainer,
} from "../../../packages/bridge/src/index";
import { viewProblems } from "../../../packages/bridge/src/stub-views";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = () => readJson(join(root, "plugins/today/plugin.json")) as PluginManifest;

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

/** The view inline in the manifest, and its four sections in grid order. */
function today(): { view: View; sections: ViewComponent[] } {
  const view = manifest().view as View;
  return { view, sections: (view.layout as ViewContainer).children as ViewComponent[] };
}

// The view engine's clock on the fixtures' day, Friday 30 October 2026 in Seoul, filled by hand as
// desk.views fills it ({today} and the others are the starts of days in the view's zone).
const CLOCK: Record<string, string> = {
  "{now}": "2026-10-30T09:00:00+09:00",
  "{today}": "2026-10-30T00:00:00+09:00",
  "{tomorrow}": "2026-10-31T00:00:00+09:00",
  "{yesterday}": "2026-10-29T00:00:00+09:00",
};

/** A binding as a reader without the engine sends it: its require bound, its clock filled. */
function bound(binding: ItemQuery): ItemQuery {
  return {
    ...binding,
    sources: (binding.sources ?? []).map((s) => (s.startsWith("$") ? "desk.fixtures/default" : s)),
    where: (binding.where ?? []).map((condition) => ({
      ...condition,
      value:
        typeof condition.value === "string"
          ? (CLOCK[condition.value] ?? condition.value)
          : condition.value,
    })),
  };
}

/** The stub's index with its fixture items, read by a caller that holds data:read. */
function reader() {
  const READER = "test.today";
  const core = stubCommands(() => {}, { grants: { [READER]: [{ permission: "data:read" }] } });
  const client = new BridgeClient(browserStub(core.handlers));
  return async (query: ItemQuery): Promise<Item[]> =>
    (
      await client.call(
        "data.query",
        { query, scope: { permission: "data:read" } },
        { caller: READER },
      )
    ).items;
}

const ids = (items: Item[]) => items.map((item) => item.id);
const at = (item: Item, field: string) =>
  Date.parse(String((item as unknown as Record<string, unknown>)[field]));

describe("desk.today", () => {
  it("is a view plugin with the today view inline, desk.today.open and its key", () => {
    const validate = manifestValidator();
    const plugin = manifest();
    expect(validate(plugin), JSON.stringify(validate.errors)).toBe(true);
    expect(plugin).toMatchObject({ id: "desk.today", name: "Today", kind: "view" });
    expect(plugin.entry).toBeUndefined();
    expect(plugin.views).toBeUndefined();
    expect(plugin.view).toMatchObject({
      id: "desk.today",
      version: "0.1.0",
      title: "Today",
      layout: { type: "grid", columns: 2 },
    });
    expect(viewProblems(plugin.view as View)).toEqual([]);
    expect(plugin.contributes?.commands).toEqual([
      {
        id: "desk.today.open",
        title: "Open today",
        keywords: ["today", "agenda", "day", "morning"],
        runs: { command: "desk.views.open", args: { id: "desk.today" } },
      },
    ]);
    expect(plugin.contributes?.keys).toEqual([{ key: "Mod+T", command: "desk.today.open" }]);
  });

  it("binds each section to its own require: a calendar, then tasks, messages and notes", () => {
    const { view, sections } = today();
    expect(view.requires).toEqual({
      calendar: { kinds: ["event"], title: "A calendar" },
      tasks: { kinds: ["task"], title: "A task list (optional)" },
      messages: { kinds: ["message"], title: "Messages (optional)" },
      notes: { kinds: ["note"], title: "Notes (optional)" },
    });
    expect(sections.map((s) => [s.type, s.title, s.binding?.kinds, s.binding?.sources])).toEqual([
      ["agenda", "Schedule", ["event"], ["$calendar"]],
      ["list", "Due", ["task"], ["$tasks"]],
      ["list", "Unread", ["message"], ["$messages"]],
      ["list", "Last touched", ["note"], ["$notes"]],
    ]);
    for (const section of sections) {
      const [source = ""] = section.binding?.sources ?? [];
      const require = view.requires?.[source.slice(1)];
      expect(require?.kinds, source).toEqual(section.binding?.kinds);
    }
    expect(sections[0]?.range).toBe("day");
    expect(sections.map((s) => s.empty)).toEqual([
      "Nothing on the calendar today.",
      "Nothing due.",
      "No unread messages.",
      "No notes yet.",
    ]);
  });

  it("every section's binding answers the fixture items through data.query without the engine", async () => {
    const query = reader();
    const [schedule, due, unread, touched] = today().sections.map((s) => bound(s.binding ?? {}));
    if (!schedule || !due || !unread || !touched) throw new Error("four sections");

    // Today's events, earliest first; the all-day hike is tomorrow's.
    const events = await query(schedule);
    expect(ids(events)).toEqual(["ev-standup", "ev-lunch", "ev-review"]);
    expect(events.every((item) => item.kind === "event")).toBe(true);

    // Open tasks due by the end of today, earliest first: not tomorrow's, not a done one.
    const tasks = await query(due);
    expect(ids(tasks)).toEqual(["task-report"]);
    for (const task of tasks) expect(task).toMatchObject({ kind: "task", status: "open" });
    for (const task of tasks)
      expect(at(task, "due")).toBeLessThan(Date.parse(CLOCK["{tomorrow}"] ?? ""));

    // Unread messages, newest first.
    const messages = await query(unread);
    expect(ids(messages)).toEqual(["msg-mina", "msg-landlord"]);
    for (const message of messages)
      expect(message).toMatchObject({ kind: "message", unread: true });

    // The notes touched last, newest first, five at most.
    const notes = await query(touched);
    expect(ids(notes)).toEqual(["note-offsite", "note-stew"]);
    expect(notes.every((item) => item.kind === "note")).toBe(true);
    expect(touched.limit).toBe(5);
    const times = notes.map((note) => at(note, "updatedAt"));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
