import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { KeyBinding, PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import type { ScriptedAnswer } from "../bridge/scripted-brain";
import { PolicyHub } from "../hub";
import { ShortcutRouter } from "../input";
import type { DeskContext } from "../policies/context";
import { installKeys, PERSONAL_KEYS } from "../policies/keys";
import { type AskTool, createAsker } from "./asker";
import type { Card, CardContent } from "./card";
import { BIND, TERMINAL_KEYS } from "./fixtures";
import { keysKind, settingsKeys } from "./keys";
import { type Choice, createProposals } from "./pipeline";

const root = join(import.meta.dirname, "../../../..");
const MANAGE = { permission: "plugin:manage" } as const;
const manifest = (name: string) =>
  JSON.parse(readFileSync(join(root, "plugins", name, "plugin.json"), "utf8")) as PluginManifest;
/** An answer through the tool: a few words and the call's arguments. */
const told = (value: unknown): ScriptedAnswer => ({
  text: "Here they are.",
  structured: value as Record<string, unknown>,
});

/** Core keys, the palette and the terminal on the stub core (macOS), the keys kind on a scripted brain. */
async function setup(answers: unknown[], choices: Choice[] = [{ choice: "apply" }]) {
  const core = browserCore({
    manifests: ["palette", "terminal"].map(manifest),
    brain: { answer: () => told(answers.shift() ?? {}) },
  });
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  hub.apply((await bridge.call("plugin.list", { scope: MANAGE })).plugins);
  await hub.readInit(bridge);
  const shortcuts = new ShortcutRouter({ platform: "mac" });
  installKeys({ hub, shortcuts } as unknown as DeskContext);
  await hub.commands.settled();
  const shown: CardContent[] = [];
  const applied: CardContent[] = [];
  let closed = 0;
  const card: Card = {
    preview: async (content) => {
      shown.push(structuredClone(content));
      return choices.shift() ?? { choice: "discard" };
    },
    applied: (content) => void applied.push(content),
    close: () => void closed++,
  };
  const said: string[] = [];
  const keys = settingsKeys(
    { settings: hub.settings, policy: () => hub.policy, commands: hub.commands },
    "mac",
  );
  const proposals = createProposals({
    asker: createAsker(bridge),
    kinds: [keysKind({ keys, commands: hub.commands, card })],
    notify: () => {},
    eris: { say: (text) => void said.push(text), setState: () => {} },
  });
  const asks = () =>
    core.stub.log
      .filter((entry) => entry.request.method === "brain.ask")
      .map((entry) => entry.request.params as { prompt: string; tool: AskTool });
  const prompts = () => asks().map((ask) => ask.prompt);
  const tools = () => asks().map((ask) => ask.tool);
  const inForce = async (combo: string) =>
    (
      (await hub.commands.run("desk.keys.list")) as Array<{
        combo: string;
        command: string;
        owner: string;
      }>
    ).find((binding) => binding.combo === combo);
  const session = () => hub.settings.layer("session")[PERSONAL_KEYS] as KeyBinding[] | undefined;
  return {
    hub,
    proposals,
    prompts,
    tools,
    inForce,
    session,
    shown,
    applied,
    said,
    closed: () => closed,
  };
}

const rowsOf = (content: CardContent | undefined) => (content?.kind === "keys" ? content.rows : []);
const NEW = { command: "endue.terminal.new", title: "New terminal", owner: "endue.terminal" };

describe("desk.propose for key bindings", () => {
  it("bind Mod+Shift+T to open the terminal: the row is marked taken, Apply writes the person's layer, Undo leaves no trace", async () => {
    const m = await setup([TERMINAL_KEYS]);
    expect(await m.inForce("Meta+Shift+T")).toMatchObject({ command: "endue.terminal.new" });
    const outcome = await m.proposals.propose("keys", BIND);
    expect(outcome).toMatchObject({ status: "applied", kind: "keys" });

    const [prompt = ""] = m.prompts();
    expect(prompt).toContain(BIND);
    // The commands that match the sentence and their keys in force, not every command.
    expect(prompt).toContain('{"id":"endue.terminal.focus","title":"Focus the terminal"}');
    expect(prompt).toContain('{"key":"Meta+Shift+T","command":"endue.terminal.new"}');
    expect(prompt).not.toContain("desk.keys.quit");
    // The tool's schema is a list of KeyBinding.
    const [tool] = m.tools();
    expect(tool?.name).toBe("propose_key_bindings");
    expect(JSON.stringify(tool?.schema)).toContain('"KeyBinding"');

    expect(m.shown).toEqual([
      {
        kind: "keys",
        title: "⇧⌘T → Focus the terminal",
        rows: [
          {
            key: "⇧⌘T",
            combo: "Meta+Shift+T",
            command: "endue.terminal.focus",
            title: "Focus the terminal",
            now: NEW,
            marks: ["taken"],
          },
        ],
      },
    ]);
    expect(m.session()).toEqual([{ key: "Mod+Shift+T", command: "endue.terminal.focus" }]);
    expect(await m.inForce("Meta+Shift+T")).toEqual({
      key: "⇧⌘T",
      combo: "Meta+Shift+T",
      command: "endue.terminal.focus",
      owner: "person",
    });
    expect(m.applied.map((content) => content.title)).toEqual(["⇧⌘T → Focus the terminal"]);
    expect(m.said).toEqual(["I bound ⇧⌘T to Focus the terminal."]);

    await m.proposals.undo();
    expect(PERSONAL_KEYS in m.hub.settings.layer("session")).toBe(false);
    expect(await m.inForce("Meta+Shift+T")).toMatchObject({ command: "endue.terminal.new" });
    expect(m.closed()).toBe(1);
  });

  it("Undo puts back the person's own layer exactly, the entry on the same chord included", async () => {
    const m = await setup([TERMINAL_KEYS]);
    const before: KeyBinding[] = [
      { key: "Mod+J", command: "desk.palette.open" },
      { key: "Mod+Shift+T", command: "desk.keys.list" },
    ];
    m.hub.settings.set(PERSONAL_KEYS, before);
    await m.proposals.propose("keys", BIND);
    expect(rowsOf(m.shown[0])[0]).toMatchObject({
      now: { command: "desk.keys.list", owner: "person" },
      marks: ["taken"],
    });
    expect(m.session()).toEqual([
      { key: "Mod+J", command: "desk.palette.open" },
      { key: "Mod+Shift+T", command: "endue.terminal.focus" },
    ]);
    await m.proposals.undo({ kind: "keys" });
    expect(m.session()).toEqual(before);
  });

  it("two proposals on one chord are both marked, and one that is already there says so", async () => {
    const m = await setup(
      [
        {
          bindings: [
            { key: "Mod+Shift+T", command: "endue.terminal.focus" },
            { key: "Mod+Shift+T", command: "endue.terminal.new" },
            { key: "Mod+Alt+T", command: "endue.terminal.clear" },
          ],
        },
      ],
      [{ choice: "discard" }],
    );
    expect(await m.proposals.propose("keys", BIND)).toEqual({ status: "discarded" });
    const content = m.shown[0];
    expect(rowsOf(content).map((row) => [row.key, row.marks])).toEqual([
      ["⇧⌘T", ["taken", "twice"]],
      ["⇧⌘T", ["twice", "same"]],
      ["⌥⌘T", []],
    ]);
    expect(content?.title).toBe("3 key bindings");
    expect(m.session()).toBeUndefined();
  });

  it("a key the core binds is taken with no keys plugin installed (ADR 0055)", async () => {
    const m = await setup(
      [{ bindings: [{ key: "Mod+K", command: "endue.terminal.focus" }] }],
      [{ choice: "discard" }],
    );
    expect(await m.proposals.propose("keys", BIND)).toEqual({ status: "discarded" });
    expect(rowsOf(m.shown[0])).toMatchObject([
      {
        key: "⌘K",
        command: "endue.terminal.focus",
        now: { command: "desk.palette.open", owner: "desk" },
        marks: ["taken"],
      },
    ]);
  });

  it("a command the desk does not have is asked again with the problem", async () => {
    const m = await setup(
      [{ bindings: [{ key: "Mod+Shift+T", command: "endue.terminal.open" }] }, TERMINAL_KEYS],
      [{ choice: "discard" }],
    );
    await m.proposals.propose("keys", BIND);
    const [, second = ""] = m.prompts();
    expect(second).toContain("/bindings/0/command: the desk has no command endue.terminal.open");
    expect(m.shown).toHaveLength(1);
  });
});
