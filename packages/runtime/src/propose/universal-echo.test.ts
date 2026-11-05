import { describe, expect, it } from "vitest";
import { proposeUniversalView } from "../../../../examples/brain-echo/universal.mjs";
import { promptFor } from "./pipeline";
import { specSchemas, UNIVERSAL } from "./specs";

// brain-echo's propose_universal_view, as desk.propose asks it: a universal view the runtime's
// checker accepts once the desk adds its id, from the shape and the source a sentence names.
const ask = (text: string, corrections: string[] = []) =>
  proposeUniversalView(
    promptFor({ noun: "view", guide: "A guide." }, { text, corrections }, { kinds: [] }, [], 32000),
  ) as Record<string, unknown>;
const valid = (view: Record<string, unknown>) =>
  specSchemas().validate({ ...view, id: "eris.test" }, UNIVERSAL);

describe("brain-echo's propose_universal_view", () => {
  it("makes this repo's issues a board over the task items, in the task statuses' order", () => {
    const view = ask("show this repo's issues as a board");
    expect(view).toMatchObject({
      title: "Issues board",
      type: "kanban",
      types: ["kanban", "list", "timeline", "calendar"],
      source: { items: { kinds: ["task"] } },
      options: { groups: ["open", "done", "cancelled"] },
    });
    expect(valid(view)).toEqual([]);
  });

  it("makes a folder a timeline through desk.universal.folder, a data file a file source, a URL a list", () => {
    const folder = ask("show this folder ~/notes as a timeline");
    expect(folder).toMatchObject({
      title: "Notes timeline",
      type: "timeline",
      source: { command: "desk.universal.folder", args: { path: "~/notes" } },
    });
    const file = ask("show ~/plans/q4.yaml as a calendar");
    expect(file).toMatchObject({ type: "calendar", source: { file: "~/plans/q4.yaml" } });
    const url = ask("show https://status.example.test/feed.yaml");
    expect(url).toMatchObject({
      type: "list",
      source: { url: "https://status.example.test/feed.yaml" },
    });
    for (const view of [folder, file, url]) expect(valid(view)).toEqual([]);
  });

  it("reads the corrections after the sentence, a later shape winning, and answers the same twice", () => {
    expect(ask("show my events as a board", ["make it a calendar"])).toMatchObject({
      type: "calendar",
      source: { items: { kinds: ["event"] } },
    });
    expect(ask("show my notes")).toEqual(ask("show my notes"));
    expect(valid(ask("something with no words it knows"))).toEqual([]);
  });
});
