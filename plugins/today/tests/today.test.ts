import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  browserStub,
  type Item,
  type PluginManifest,
  stubCommands,
  type UniversalPage,
  type UniversalView,
} from "../../../packages/bridge/src/index";
import { pageProblems } from "../../../packages/bridge/src/stub-universal";
import { fillQuery } from "../../../packages/plugin-sdk/src/universal-clock";
import { entriesFromItems } from "../../../packages/plugin-sdk/src/universal-load";

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

/** The page inline in the manifest, and its sections in reading order. */
function today(): { page: UniversalPage; sections: UniversalView[] } {
  const page = manifest().view as UniversalPage;
  return { page, sections: page.sections };
}

// The fixtures' day, Friday 30 October 2026 at 09:00 in Seoul: the SDK fills {today}, {tomorrow}
// and {now} from it as desk.universal does when a section loads (ADR 0103).
const NOW = Date.parse("2026-10-30T09:00:00+09:00");
const ZONE = "Asia/Seoul";
const TOMORROW = Date.parse("2026-10-31T00:00:00+09:00");

/** The GitHub connector's work as desk.github indexes it: two open, one closed. */
function githubWork(): Item[] {
  const task = (id: string, status: "open" | "done", updatedAt: string): Item => ({
    id,
    kind: "task",
    source: { connector: "desk.github", instance: "default" },
    title: `Work ${id}`,
    status,
    project: "endue-ai/desk",
    updatedAt,
  });
  return [
    task("gh-review", "open", "2026-10-29T18:00:00+09:00"),
    task("gh-closed", "done", "2026-10-30T08:00:00+09:00"),
    task("gh-issue", "open", "2026-10-30T07:30:00+09:00"),
  ];
}

/** The items a section's source answers from the stub's fixtures, read with data:read. */
function reader() {
  const READER = "test.today";
  const core = stubCommands(() => {}, { grants: { [READER]: [{ permission: "data:read" }] } });
  for (const item of githubWork()) core.upsert(item);
  const client = new BridgeClient(browserStub(core.handlers));
  return async (section: UniversalView): Promise<Item[]> => {
    if (!("items" in section.source)) throw new Error(`${section.title}: not an items source`);
    const query = fillQuery(section.source.items, { now: NOW, zone: ZONE });
    const scope = { permission: "data:read" } as const;
    return (await client.call("data.query", { query, scope }, { caller: READER })).items;
  };
}

const ids = (items: Item[]) => items.map((item) => item.id);
const at = (item: Item, field: string) =>
  Date.parse(String((item as unknown as Record<string, unknown>)[field]));

describe("desk.today", () => {
  it("is a view plugin with the today page inline, desk.today.open and its key", () => {
    const validate = manifestValidator();
    const plugin = manifest();
    expect(validate(plugin), JSON.stringify(validate.errors)).toBe(true);
    expect(plugin).toMatchObject({ id: "desk.today", name: "Today", kind: "view" });
    expect(plugin.entry).toBeUndefined();
    expect(plugin.views).toBeUndefined();
    const { page } = today();
    expect(page).toMatchObject({ id: "desk.today", title: "Today", columns: 2 });
    expect(pageProblems(page)).toEqual([]);
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

  it("is five sections, each over its own kind: a day's calendar, then four lists", () => {
    const { sections } = today();
    const shape = sections.map((s) => {
      const items = "items" in s.source ? s.source.items : undefined;
      return [s.type, s.title, items?.kinds, items?.sources];
    });
    expect(shape).toEqual([
      ["calendar", "Schedule", ["event"], undefined],
      ["list", "Due", ["task"], undefined],
      ["list", "Unread", ["message"], undefined],
      ["list", "Last touched", ["note"], undefined],
      ["list", "GitHub", ["task"], ["desk.github"]],
    ]);
    expect(sections[0]?.options?.range).toBe("day");
    expect(sections.map((s) => s.empty)).toEqual([
      "Nothing on the calendar.",
      "Nothing due.",
      "No unread messages.",
      "No notes yet.",
      "No open GitHub work.",
    ]);
  });

  it("each section answers the fixture items the item view's sections did, as entries", async () => {
    const query = reader();
    const [schedule, due, unread, touched] = today().sections;
    if (!schedule || !due || !unread || !touched) throw new Error("five sections");

    // Today's events, earliest first; the all-day hike is tomorrow's.
    const events = await query(schedule);
    expect(ids(events)).toEqual(["ev-standup", "ev-lunch", "ev-review"]);
    // Each is an entry with its start and end, which the day's calendar places.
    for (const entry of entriesFromItems(events)) expect(entry.start && entry.end).toBeTruthy();

    // Open tasks due by the end of today, earliest first: not tomorrow's, not a done one.
    const tasks = await query(due);
    expect(ids(tasks)).toEqual(["task-report"]);
    for (const task of tasks) expect(task).toMatchObject({ kind: "task", status: "open" });
    for (const task of tasks) expect(at(task, "due")).toBeLessThan(TOMORROW);

    // Unread messages, newest first.
    const messages = await query(unread);
    expect(ids(messages)).toEqual(["msg-mina", "msg-landlord"]);
    expect(entriesFromItems(messages).map((e) => e.status)).toEqual(["unread", "unread"]);

    // The notes touched last, newest first, five at most.
    const notes = await query(touched);
    expect(ids(notes)).toEqual(["note-offsite", "note-stew"]);
    const times = notes.map((note) => at(note, "updatedAt"));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect("items" in touched.source && touched.source.items.limit).toBe(5);
  });

  it("shows GitHub work in a section of its own: open, the last updated first", async () => {
    const github = today().sections.find((s) => s.title === "GitHub");
    if (!github) throw new Error("no GitHub section");
    const tasks = await reader()(github);
    expect(ids(tasks)).toEqual(["gh-issue", "gh-review"]);
    // The project is the entry's detail, as the item view's "{project} · …" line had it.
    expect(entriesFromItems(tasks).map((e) => e.detail)).toEqual([
      "endue-ai/desk",
      "endue-ai/desk",
    ]);
  });
});
