import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  stubCommands,
  type UniversalView,
} from "./index";

// The browser stub keeps universal views beside item views as the core does (ADR 0102): an id names
// the file, view.list sums one up with its type, and a view it cannot draw is invalid_params.
function setup() {
  const events: BridgeEvent[] = [];
  const core = stubCommands((event) => events.push(event));
  const client = new BridgeClient(browserStub(core.handlers));
  return { client, events };
}

const VIEWS = { permission: "view:manage" } as const;
const BOARD: UniversalView = {
  id: "eris.issues-as-a-board",
  title: "Issues as a board",
  type: "kanban",
  types: ["kanban", "list", "timeline", "calendar"],
  source: { items: { kinds: ["task"] } },
  map: { group: "status" },
};

describe("the stub's universal views", () => {
  it("view.save keeps one, view.list sums it up with its type, view.get answers it, view.remove drops it", async () => {
    const { client } = setup();
    await expect(client.call("view.save", { view: BOARD, scope: VIEWS })).resolves.toEqual({});
    const { views } = await client.call("view.list", { scope: VIEWS });
    expect(views).toEqual([
      { id: BOARD.id, title: "Issues as a board", type: "kanban", source: "file" },
    ]);
    expect(views[0]).not.toHaveProperty("version");
    const got = await client.call("view.get", { id: "eris.issues-as-a-board", scope: VIEWS });
    expect(got).toEqual({ view: BOARD, source: "file" });
    await client.call("view.remove", { id: "eris.issues-as-a-board", scope: VIEWS });
    await expect(client.call("view.list", { scope: VIEWS })).resolves.toEqual({ views: [] });
  });

  it("a universal view without a title is listed by its id", async () => {
    const { client } = setup();
    const { title: _, ...untitled } = BOARD;
    await client.call("view.save", { view: untitled, scope: VIEWS });
    const { views } = await client.call("view.list", { scope: VIEWS });
    expect(views[0]?.title).toBe(BOARD.id);
  });

  it("refuses one without an id, two sources, an unknown presentation or a refresh under 5 seconds", async () => {
    const { client } = setup();
    const { id: _, ...unnamed } = BOARD;
    const twoSources = { ...BOARD, source: { items: {}, url: "https://x.test/a.yaml" } };
    const unknown = { ...BOARD, type: "spreadsheet" };
    const hasty = { ...BOARD, refresh: 2 };
    for (const [view, said] of [
      [unnamed, "/id"],
      [twoSources, "/source"],
      [unknown, "/type"],
      [hasty, "/refresh"],
    ] as const)
      await expect(
        client.call("view.save", { view: view as UniversalView, scope: VIEWS }),
      ).rejects.toMatchObject({ code: "invalid_params", message: expect.stringContaining(said) });
    await expect(client.call("view.list", { scope: VIEWS })).resolves.toEqual({ views: [] });
  });

  it("announces a saved universal view as view.changed", async () => {
    const { client, events } = setup();
    await client.call("view.save", { view: BOARD, scope: VIEWS });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.filter((e) => e.event === "view.changed")).toEqual([
      { event: "view.changed", data: { id: BOARD.id, change: "saved" } },
    ]);
  });
});
