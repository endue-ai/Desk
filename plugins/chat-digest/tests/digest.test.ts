import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type {
  Item,
  PluginManifest,
  UniversalPage,
  UniversalView,
} from "../../../packages/bridge/src/index";
import { page } from "../../../packages/bridge/src/stub-query";
import { pageProblems } from "../../../packages/bridge/src/stub-universal";
import { sample } from "../../chat/tests/chat-fixtures";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = () => readJson(join(root, "plugins/chat-digest/plugin.json")) as PluginManifest;
const chat = () => readJson(join(root, "plugins/chat/plugin.json")) as PluginManifest;

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
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

const view = () => manifest().view as UniversalPage;
const sections = () => view().sections;
/** A section's items query, if it has one. */
const query = (s: UniversalView) => ("items" in s.source ? s.source.items : undefined);
/** A section's items from the chat fixtures (three services and one mail message). */
const answer = (s: UniversalView): Item[] => {
  const items = query(s);
  return items ? page(sample(), items).items : [];
};

describe("endue.chat-digest", () => {
  it("is a data-only view plugin with one inline page and an alias that opens it", () => {
    const validate = manifestValidator();
    const plugin = manifest();
    expect(validate(plugin), JSON.stringify(validate.errors)).toBe(true);
    expect(plugin).toMatchObject({ id: "endue.chat-digest", kind: "view" });
    expect(plugin.entry).toBeUndefined();
    expect(pageProblems(view())).toEqual([]);
    // Three counts in a row over the three lists, as the item view's two grids had them.
    expect(view()).toMatchObject({ id: "endue.chat-digest", columns: 3 });
    expect(plugin.contributes?.commands).toEqual([
      expect.objectContaining({
        id: "endue.chat-digest.open",
        runs: { command: "desk.views.open", args: { id: "endue.chat-digest" } },
      }),
    ]);
  });

  it("draws three counts and three lists, every one over chat messages only", () => {
    expect(sections().map((s) => `${s.type}:${s.title}`)).toEqual([
      "stat:Unread",
      "stat:Mentions",
      "stat:Direct",
      "list:Mentions",
      "list:Direct messages",
      "list:Latest across every chat",
    ]);
    for (const s of sections()) {
      expect(query(s)?.kinds, s.title).toEqual(["message"]);
      expect(query(s)?.where?.[0], s.title).toEqual({ field: "raw.channel", op: "exists" });
      // No sources named: one digest covers every chat account at once.
      expect(query(s)?.sources, s.title).toBeUndefined();
      expect(s.empty, s.title).toBeTruthy();
    }
  });

  it("each section answers the chat fixtures as the chat plugin counts them, mail left out", () => {
    const [unread, mentions, direct, mentionList, dmList, latest] = sections().map(answer);
    expect(unread?.map((i) => i.id).sort()).toEqual(["d-2", "s-3", "s-4", "s-6", "s-7"]);
    expect(mentions?.map((i) => i.id)).toEqual(["s-6"]);
    expect(direct?.map((i) => i.id)).toEqual(["s-7"]);
    expect(mentionList?.map((i) => i.id)).toEqual(["s-6"]);
    expect(dmList?.map((i) => i.id)).toEqual(["s-7"]);
    expect(latest?.map((i) => i.id)).toEqual([
      "d-2",
      "s-7",
      "s-6",
      "s-5",
      "s-4",
      "s-3",
      "s-2",
      "s-1",
      "d-1",
      "t-1",
    ]);
  });

  it("its actions are endue.chat's commands, with the item's source and id", () => {
    const commands = new Set((chat().contributes?.commands ?? []).map((c) => c.id));
    const actions = sections().flatMap((s) => s.actions ?? []);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(commands.has(action.command), action.command).toBe(true);
      expect(action.args).toEqual({
        source: { connector: "{source.connector}", instance: "{source.instance}" },
        id: "{id}",
      });
    }
  });
});
