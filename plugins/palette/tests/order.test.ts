// The palette's order without a DOM: the commands with the plugins' hits, and the first list.
import { describe, expect, it } from "vitest";
import { commandEntries, rank, runnable, SECTIONS } from "../ui/match.js";

type Entry = { id: string; section?: string };
const ids = (entries: Entry[]) => entries.map((entry) => entry.id);
const hit = (id: string, title: string, kind = "plugin") => ({
  id: `${kind}:${id}`,
  label: title,
  hit: { id: `${kind}:${id}`, kind, title, plugin: id },
});

const commands = [
  { id: "desk.fleet.open", label: "Fleet: open the agents' board", keywords: ["agents", "fleet"] },
  { id: "desk.eris.summon", label: "Talk to Eris", keywords: ["eris", "talk"] },
  { id: "endue.docker.shell", label: "Docker: open a shell", keywords: ["terminal"] },
  { id: "endue.terminal.new", label: "New terminal", keywords: ["shell"] },
];
const plugins = [
  hit("endue.agents", "Agents"),
  hit("endue.eris", "Eris"),
  hit("endue.terminal", "Terminal"),
];

describe("rank, typed", () => {
  const [agents, eris, terminal] = plugins;
  it("puts the plugin named as typed first, then labels, then keywords", () => {
    expect(ids(rank("Agents", commands, [agents]))).toEqual([
      "plugin:endue.agents",
      "desk.fleet.open",
    ]);
    expect(ids(rank("eris", commands, [eris]))).toEqual(["plugin:endue.eris", "desk.eris.summon"]);
    expect(ids(rank("term", commands, [terminal]))).toEqual([
      "plugin:endue.terminal",
      "endue.terminal.new",
      "endue.docker.shell",
    ]);
  });

  it("finds a plugin by its id, and keeps a hit the index found elsewhere after the matches", () => {
    const docker = hit("endue.docker", "Docker");
    expect(ids(rank("endue.docker", commands, [docker]))).toEqual([
      "plugin:endue.docker",
      "endue.docker.shell",
    ]);
    // The index matched the plugin's description; its title does not hold "term".
    expect(ids(rank("term", commands, [docker, terminal]))).toEqual([
      "plugin:endue.terminal",
      "endue.terminal.new",
      "endue.docker.shell",
      "plugin:endue.docker",
    ]);
  });

  it("puts a hit ahead of a command that matches as well", () => {
    const market = [{ id: "desk.market.open", label: "Market" }];
    expect(ids(rank("market", market, [hit("desk.market", "Market")]))).toEqual([
      "plugin:desk.market",
      "desk.market.open",
    ]);
  });
});

describe("rank, nothing typed", () => {
  it("is the recent ones, the plugins, then the commands, each in its section; no published data", () => {
    const note = hit("endue.notes", "a.md", "document");
    const list = rank(
      "",
      commands,
      [...plugins, note],
      ["endue.terminal.new", "plugin:endue.eris"],
    );
    expect(list.map((entry: Entry) => [entry.section, entry.id])).toEqual([
      [SECTIONS.recent, "endue.terminal.new"],
      [SECTIONS.recent, "plugin:endue.eris"],
      [SECTIONS.plugins, "plugin:endue.agents"],
      [SECTIONS.plugins, "plugin:endue.terminal"],
      [SECTIONS.commands, "desk.fleet.open"],
      [SECTIONS.commands, "desk.eris.summon"],
      [SECTIONS.commands, "endue.docker.shell"],
    ]);
  });
});

describe("commandEntries", () => {
  const needs = { type: "object", required: ["plugin"] };
  const listed = [
    { id: "desk.shell.desktop-10", title: "Desktop · 10", provider: "desk" },
    { id: "desk.frames.stop", title: "Not responding · stop", provider: "desk", argsSchema: needs },
    { id: "desk.palette.open", title: "Search Desk", provider: "desk.palette" },
    { id: "desk.shell.desktop-2", title: "Desktop · 2", provider: "desk", keywords: ["two"] },
    { id: "desk.inbox.open", title: "inbox", provider: "desk" },
    {
      id: "desk.keys.list",
      title: "List key bindings",
      provider: "desk",
      argsSchema: { type: "object" },
    },
  ];

  it("lists them A to Z by title, numbers by value, without the hidden and those that need args", () => {
    const bindings = [{ key: "⌃2", command: "desk.shell.desktop-2" }];
    const entries = commandEntries(listed, bindings, new Set(["desk.palette.open"]));
    expect(ids(entries)).toEqual([
      "desk.shell.desktop-2",
      "desk.shell.desktop-10",
      "desk.inbox.open",
      "desk.keys.list",
    ]);
    expect(entries[0]).toEqual({
      id: "desk.shell.desktop-2",
      provider: "desk",
      label: "Desktop · 2",
      keywords: ["two"],
      keys: ["⌃2"],
    });
  });

  it("is the same list whatever order the registry holds them in", () => {
    const hidden = new Set<string>();
    expect(commandEntries([...listed].reverse(), [], hidden)).toEqual(
      commandEntries(listed, [], hidden),
    );
  });

  it("runs a command as it is only when its argsSchema requires nothing", () => {
    expect(runnable({ argsSchema: needs })).toBe(false);
    expect(runnable({ argsSchema: { type: "object", required: [] } })).toBe(true);
    expect(runnable({})).toBe(true);
  });
});
