import { FIXTURE_NOW, type PluginManifest, type UniversalView } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import type { Commands } from "../commands";
import { installProposals } from "./install";
import { typesFor, universalKind } from "./universal";

// desk.propose's view kind makes universal views (ADR 0102): asked through propose_universal_view,
// named and checked by the desk, previewed in desk.universal, saved with view.save, undone.
const VIEWS = { permission: "view:manage" } as const;
const manifests: PluginManifest[] = [
  { id: "desk.universal", version: "0.1.0", kind: "ui", entry: "ui/index.html" },
];
const SENTENCE = "show this repo's issues as a board";
const request = { text: SENTENCE, corrections: [] };
const BOARD = {
  title: "Issues board",
  type: "kanban",
  source: { items: { kinds: ["task"] } },
  options: { groups: ["open", "done", "cancelled"] },
};

/** The kind over a stub core, with every command it runs recorded and answered by `answer`. */
function setup(answer: (id: string, args: unknown) => unknown = () => ({})) {
  const core = browserCore({ manifests, brain: { answer: () => "" } });
  const ran: Array<{ id: string; args: unknown }> = [];
  const kind = universalKind({
    bridge: core.client,
    commands: {
      run: async (id, args) => {
        ran.push({ id, args });
        return answer(id, args);
      },
    },
    now: () => Date.parse(FIXTURE_NOW),
    profile: () => undefined,
  });
  return { core, kind, ran };
}

describe("the universal view kind", () => {
  it("asks through propose_universal_view with UniversalView bundled without id and provenance", () => {
    const { kind } = setup();
    const tool = kind.tool();
    expect(tool.name).toBe("propose_universal_view");
    const props = tool.schema.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["type", "source", "map", "types"]));
    expect(props).not.toHaveProperty("id");
    expect(props).not.toHaveProperty("provenance");
    expect(tool.schema.required).toEqual(["type", "source"]);
    expect(JSON.stringify(tool.schema)).toContain("One sentence about what the view shows.");
    expect(JSON.stringify(kind.compact())).not.toContain("One sentence about what the view shows.");
  });

  it("names it eris.<slug>, -2 when taken, records provenance and puts its type first in types", async () => {
    const { core, kind } = setup();
    const taken: UniversalView = { ...BOARD, id: "eris.issues-board" } as UniversalView;
    await core.client.call("view.save", { view: taken, scope: VIEWS });
    const checked = await kind.check({ ...BOARD, id: "brain.mine", provenance: {} }, request);
    expect(checked).toEqual({
      value: {
        ...BOARD,
        types: ["kanban", "list", "timeline", "calendar"],
        id: "eris.issues-board-2",
        provenance: {
          author: "eris",
          createdAt: "2026-10-30T00:00:00.000Z",
          words: SENTENCE,
          brain: "scripted",
        },
      },
    });
    expect(typesFor("timeline", ["list", "timeline"])).toEqual(["timeline", "list"]);
    expect(typesFor("chat", ["list"])).toEqual(["chat", "list"]);
  });

  it("gives back a source the schema refuses as pointer problems", async () => {
    const { kind } = setup();
    const odd = await kind.check({ ...BOARD, source: { folder: "~/notes" } }, request);
    expect(odd).toHaveProperty("problems");
    expect((odd as { problems: string[] }).problems.join("; ")).toContain("/source");
    expect(await kind.check({ ...BOARD, type: "spreadsheet" }, request)).toHaveProperty("problems");
    expect(await kind.check("a board", request)).toEqual({
      problems: ["/: the answer is not a JSON object"],
    });
  });

  it("shows the drafting state, previews in desk.universal and returns the person's choice", async () => {
    const { kind, ran } = setup((id) =>
      id === "desk.universal.preview" ? { choice: "retry", correction: "only open ones" } : {},
    );
    await kind.drafting?.(request);
    const view = { ...BOARD, id: "eris.issues-board" } as UniversalView;
    expect(await kind.preview(view, request)).toEqual({
      choice: "retry",
      correction: "only open ones",
    });
    expect(ran).toEqual([
      { id: "desk.universal.drafting", args: { note: `Making a view from “${SENTENCE}”…` } },
      { id: "desk.universal.preview", args: { view, note: `Eris made this from “${SENTENCE}”.` } },
    ]);
  });

  it("applies with view.save then desk.universal.open with Undo, and undo closes and removes it", async () => {
    const { core, kind, ran } = setup();
    const view = { ...BOARD, id: "eris.issues-board" } as UniversalView;
    const applied = await kind.apply(view, request);
    expect(applied).toEqual({
      id: "eris.issues-board",
      title: "Issues board",
      where: "~/.desk/views/eris.issues-board.yaml",
    });
    const got = await core.client.call("view.get", { id: "eris.issues-board", scope: VIEWS });
    expect(got.view).toEqual(view);
    expect(ran.at(-1)).toEqual({
      id: "desk.universal.open",
      args: {
        id: "eris.issues-board",
        notice: {
          text: "Eris made this view: ~/.desk/views/eris.issues-board.yaml",
          action: {
            title: "Undo",
            command: "desk.propose.undo",
            args: { kind: "view", id: "eris.issues-board" },
          },
        },
      },
    });
    await kind.undo(applied);
    expect(ran.at(-1)).toEqual({ id: "desk.universal.close", args: { id: "eris.issues-board" } });
    await expect(
      core.client.call("view.get", { id: "eris.issues-board", scope: VIEWS }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("desk.propose makes a universal view by default and an item view only as item-view", async () => {
    const core = browserCore({ manifests, brain: { answer: () => "" } });
    const defined = new Map<string, (args: unknown) => unknown>();
    const commands = {
      define: (id: string, spec: { run(args: unknown): unknown }) => {
        defined.set(id, spec.run);
        return () => defined.delete(id);
      },
      run: async () => ({}),
    } as unknown as Commands;
    const off = installProposals({
      bridge: core.client,
      commands,
      notify: () => {},
      profile: () => undefined,
    });
    const propose = defined.get("desk.propose") as (args: unknown) => Promise<unknown>;
    const refused = await propose({ kind: "nope", text: SENTENCE }).catch((e: Error) => e.message);
    expect(refused).toBe("desk.propose: no kind nope (kinds: view,item-view)");
    off();
  });
});
