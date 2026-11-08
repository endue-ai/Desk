import { describe, expect, it } from "vitest";
import { type CapabilitySource, catalogue, summarise } from "./capabilities";
import { fakeDesk } from "./fixtures";
import { mountErisContext } from "./mount";

const registered = [
  { id: "desk.windows.list", title: "Windows · List", keywords: [], provider: "desk" },
  { id: "endue.git.commit", title: "Git · Commit", keywords: [], provider: "endue.git" },
  { id: "endue.git.state", title: "Git · State", keywords: [], provider: "endue.git" },
];
const policy = {
  plugins: ["desk.display", "endue.git", "endue.notes"],
  commands: [
    { id: "endue.git.state", title: "Git · State", owner: "endue.git" },
    { id: "endue.notes.new", title: "Notes · New note", owner: "endue.notes" },
  ],
};
const bindings = [
  { combo: "Meta+Shift+G", command: "endue.git.state", owner: "endue.git", keys: ["⌘⇧G"] },
  { combo: "Meta+K", command: "desk.palette.open", owner: "desk", keys: ["⌘K"] },
  { combo: "Meta+Alt+N", command: "endue.notes.new", owner: "endue.notes", keys: ["⌘⌥N"] },
];

const source: CapabilitySource = {
  commands: () => registered,
  contributed: () => policy.commands,
  bindings: () => bindings,
  keysOf: (id) => bindings.filter((b) => b.command === id).flatMap((b) => b.keys),
  plugins: () => policy.plugins,
  windows: () => [{ id: "endue.git", title: "Git" }],
};

describe("what the person can do (ADR 0124)", () => {
  it("lists every command, the desk's and the plugins', with its owner, keys and availability", () => {
    expect(catalogue(source).commands).toEqual([
      {
        id: "desk.palette.open",
        title: "desk.palette.open",
        owner: "desk",
        keys: ["⌘K"],
        available: false,
      },
      {
        id: "desk.windows.list",
        title: "Windows · List",
        owner: "desk",
        keys: [],
        available: true,
      },
      {
        id: "endue.git.commit",
        title: "Git · Commit",
        owner: "endue.git",
        keys: [],
        available: true,
      },
      {
        id: "endue.git.state",
        title: "Git · State",
        owner: "endue.git",
        keys: ["⌘⇧G"],
        available: true,
      },
      {
        id: "endue.notes.new",
        title: "Notes · New note",
        owner: "endue.notes",
        keys: ["⌘⌥N"],
        available: false,
      },
    ]);
  });

  it("lists the plugins that are on, with their commands, their window and the views they open", () => {
    expect(catalogue(source).plugins).toEqual([
      {
        id: "desk.display",
        title: "desk.display",
        commands: 0,
        available: 0,
        open: false,
        views: [],
      },
      {
        id: "endue.git",
        title: "Git",
        commands: 2,
        available: 2,
        open: true,
        views: ["plugin:endue.git"],
      },
      {
        id: "endue.notes",
        title: "endue.notes",
        commands: 1,
        available: 0,
        open: false,
        views: [],
      },
    ]);
  });

  it("sums it up for Eris's words: counts, then the plugins with something to offer, open ones first", () => {
    expect(summarise(catalogue(source))).toEqual({
      commands: 5,
      available: 3,
      keyed: 3,
      plugins: [
        {
          id: "endue.git",
          title: "Git",
          commands: 2,
          available: 2,
          open: true,
          views: ["plugin:endue.git"],
        },
        { id: "endue.notes", title: "endue.notes", commands: 1, available: 0 },
      ],
    });
  });

  it("answers desk.capabilities read-only, by owner, word or availability", async () => {
    const desk = fakeDesk({ commands: registered, policy, bindings });
    desk.adopt("endue.git");
    mountErisContext(desk.ctx);
    const spec = desk.specs.get("desk.capabilities");
    expect(spec?.agent?.readOnly).toBe(true);
    type Answer = {
      total: number;
      available: number;
      commands: { id: string }[];
      plugins: unknown[];
    };
    const all = (await desk.run("desk.capabilities", {}, "eris")) as Answer;
    expect(all).toMatchObject({ total: 5, available: 3 });
    expect(all.commands.map((c) => c.id)).toContain("endue.notes.new");
    expect(all.plugins).toHaveLength(3);
    const git = (await desk.run("desk.capabilities", { owner: "endue.git" }, "eris")) as Answer;
    expect(git.commands.map((c) => c.id)).toEqual(["endue.git.commit", "endue.git.state"]);
    const off = (await desk.run("desk.capabilities", { available: false }, "eris")) as Answer;
    expect(off.commands.map((c) => c.id)).toEqual(["desk.palette.open", "endue.notes.new"]);
    const note = (await desk.run("desk.capabilities", { query: "NOTE" }, "eris")) as Answer;
    expect(note.commands.map((c) => c.id)).toEqual(["endue.notes.new"]);
    const one = (await desk.run("desk.capabilities", { limit: 1 }, "eris")) as Answer & {
      more?: number;
    };
    expect(one.commands).toHaveLength(1);
    expect(one.more).toBe(4);
  });
});
