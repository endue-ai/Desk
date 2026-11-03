import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import type { ScriptedAnswer, ScriptedBrain } from "../bridge/scripted-brain";
import { PolicyHub } from "../hub";
import type { DeskContext } from "../policies/context";
import { installProfiles } from "../policies/profiles";
import { ASK_LIMIT, type AskTool, createAsker } from "./asker";
import type { Card, CardContent } from "./card";
import { QUIET, quietNight, scriptedDesk } from "./fixtures";
import { type Choice, createProposals } from "./pipeline";
import { profileKind } from "./profile";

const root = join(import.meta.dirname, "../../../..");
const MANAGE = { permission: "plugin:manage" } as const;
const manifest = (name: string) =>
  JSON.parse(readFileSync(join(root, "plugins", name, "plugin.json"), "utf8")) as PluginManifest;
const BUILT_IN = ["profiles", "shell", "notify", "palette", "views"];
const APPS = ["notes", "terminal", "calendar", "mail"];
/** An answer as a brain gives it through the tool: a few words and the call's arguments. */
const told = (value: Record<string, unknown>): ScriptedAnswer => ({
  text: "Here it is.",
  structured: value,
});

/** A card that records what it is shown and answers the person's choices in order. */
function recordingCard(choices: Choice[]) {
  const shown: CardContent[] = [];
  const applied: Array<{ content: CardContent; text: string; undo(): unknown }> = [];
  let closed = 0;
  const card: Card = {
    preview: async (content) => {
      shown.push(structuredClone(content));
      return choices.shift() ?? { choice: "discard" };
    },
    applied: (content, text, undo) => void applied.push({ content, text, undo }),
    close: () => void closed++,
  };
  return { card, shown, applied, closed: () => closed };
}

/**
 * desk.profiles on the stub core with the built-in desk plugins and four apps (the terminal off),
 * Morning in force, and the profile kind in the pipeline on a scripted brain.
 */
async function setup(
  answer: ScriptedBrain["answer"],
  choices: Choice[] = [{ choice: "apply" }],
  names = [...BUILT_IN, ...APPS],
) {
  const core = browserCore({
    manifests: names.map(manifest),
    off: ["endue.terminal"],
    store: memoryStore(),
    init: { profile: "morning" },
    brain: { answer },
  });
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  const list = async () => hub.apply((await bridge.call("plugin.list", { scope: MANAGE })).plugins);
  await list();
  await hub.readInit(bridge);
  const profiles = installProfiles({ hub, bridge } as unknown as DeskContext, () => {});
  await hub.commands.settled();
  await profiles.start();
  // The plugin host lists the plugins again on every change; here before every command.
  const commands = {
    run: async (id: string, args?: unknown) => {
      await list();
      return hub.commands.run(id, args);
    },
  };
  const recorded = recordingCard(choices);
  const said: string[] = [];
  const kind = profileKind({
    bridge,
    commands,
    settings: hub.settings,
    declared: () => hub.policy.settings,
    card: recorded.card,
  });
  const proposals = createProposals({
    asker: createAsker(bridge),
    kinds: [kind],
    notify: () => {},
    eris: { say: (text) => void said.push(text), setState: () => {} },
  });
  const asks = () =>
    core.stub.log
      .filter((entry) => entry.request.method === "brain.ask")
      .map((entry) => entry.request.params as { prompt: string; tool: AskTool });
  const prompts = () => asks().map((ask) => ask.prompt);
  const tools = () => asks().map((ask) => ask.tool);
  const enabled = (id: string) => core.plugins.find((p) => p.id === id)?.enabled;
  const listed = () =>
    commands.run("desk.profiles.list") as Promise<{
      active?: string;
      profiles: Array<{ id: string; name: string; description?: string }>;
    }>;
  return { core, hub, kind, proposals, prompts, tools, enabled, listed, said, ...recorded };
}

describe("desk.propose for profiles", () => {
  it("previews the quiet night profile as a ghost, applies it with desk.profiles.save and switch, and Undo switches back and removes it", async () => {
    const m = await setup(scriptedDesk);
    const outcome = await m.proposals.propose("profile", QUIET);
    expect(outcome).toEqual({ status: "applied", kind: "profile", id: "quiet-night" });

    const [prompt = ""] = m.prompts();
    expect(prompt).toContain(QUIET);
    // The context: the plugins with their kind and state, the settings, the profiles.
    expect(prompt).toContain('"endue.terminal":"Terminal, ui, off"');
    expect(prompt).toContain('"endue.calendar":"Calendar, ui, on"');
    expect(prompt).toContain('"desk.notify.dnd":"boolean"');
    expect(prompt).toContain('"active":"morning"');
    // The tool's schema is ProfileContribution's, without the id the desk writes.
    const [tool] = m.tools();
    expect(tool?.name).toBe("propose_profile");
    expect(JSON.stringify(tool?.schema)).toContain('"ProfilePlugins"');
    expect(JSON.stringify(tool?.schema)).not.toContain('"required":["id","name"]');

    expect(m.shown).toEqual([
      {
        kind: "profile",
        title: "Quiet night",
        model: {
          id: "quiet-night",
          name: "Quiet night",
          description: "Notes and a terminal, and nothing that interrupts.",
          desktops: [
            {
              desktop: 1,
              windows: [
                {
                  id: "notes",
                  plugin: "endue.notes",
                  title: "Notes",
                  x: 120,
                  y: 200,
                  w: 520,
                  h: 480,
                },
                {
                  id: "terminal",
                  plugin: "endue.terminal",
                  title: "Terminal",
                  x: 680,
                  y: 200,
                  w: 640,
                  h: 480,
                },
              ],
            },
          ],
          on: [{ id: "endue.terminal", name: "Terminal" }],
          off: [
            { id: "endue.calendar", name: "Calendar" },
            { id: "endue.mail", name: "Mail" },
          ],
          same: 6,
          settings: [{ name: "desk.notify.dnd", from: false, to: true }],
        },
      },
    ]);

    const after = await m.listed();
    expect(after.active).toBe("quiet-night");
    expect(after.profiles.find((p) => p.id === "quiet-night")).toEqual({
      id: "quiet-night",
      ...quietNight({ "endue.calendar": "Calendar, ui, on", "endue.mail": "Mail, ui, on" }),
    });
    expect([m.enabled("endue.calendar"), m.enabled("endue.mail")]).toEqual([false, false]);
    expect(m.enabled("endue.terminal")).toBe(true);
    expect(m.hub.settings.get("desk.notify.dnd")).toBe(true);
    expect(m.applied.map((a) => a.content.title)).toEqual(["Quiet night"]);
    expect(m.said).toEqual(["I made “Quiet night” and switched to it."]);

    await m.proposals.undo({ kind: "profile", id: "quiet-night" });
    const back = await m.listed();
    expect(back.active).toBe("morning");
    expect(back.profiles.map((p) => p.id)).not.toContain("quiet-night");
    expect([m.enabled("endue.calendar"), m.enabled("endue.mail")]).toEqual([true, true]);
    expect(m.hub.settings.get("desk.notify.dnd")).toBe(false);
    expect(m.closed()).toBe(1);
    await expect(m.proposals.undo({ kind: "profile", id: "quiet-night" })).rejects.toThrow(
      /nothing/i,
    );
  });

  it("a plugin that is not installed or a setting nobody declares is asked again with the problems", async () => {
    const wrong = {
      name: "Quiet night",
      plugins: { enabled: ["endue.notes", "endue.radio"] },
      settings: { "desk.quiet": true, "desk.notify.dnd": "yes" },
    };
    const answers = [told(wrong), told(quietNight())];
    const m = await setup(() => answers.shift() ?? "", [{ choice: "discard" }]);
    expect(await m.proposals.propose("profile", QUIET)).toEqual({ status: "discarded" });
    const [, second = ""] = m.prompts();
    expect(second).toContain("Your last answer was not valid");
    expect(second).toContain("/plugins/enabled/1: endue.radio is not installed");
    expect(second).toContain("/settings/desk.quiet: no plugin declares this setting");
    expect(second).toContain("/settings/desk.notify.dnd: must be a boolean");
    expect(m.shown).toHaveLength(1);
    expect((await m.listed()).profiles.map((p) => p.id)).not.toContain("quiet-night");
  });

  it("a core setting needs no plugin to declare it (ADR 0055)", async () => {
    const m = await setup(
      scriptedDesk,
      [],
      [...BUILT_IN.filter((name) => name !== "notify"), ...APPS],
    );
    const request = { text: "make a quiet profile", corrections: [] };
    const checked = await m.kind.check(
      { name: "Quiet", settings: { "desk.notify.dnd": true } },
      request,
    );
    expect(checked).toEqual({
      value: { id: "quiet", name: "Quiet", settings: { "desk.notify.dnd": true } },
    });
    const wrong = await m.kind.check(
      { name: "Loud", settings: { "desk.notify.dnd": "yes" } },
      request,
    );
    expect(wrong).toEqual({ problems: ["/settings/desk.notify.dnd: must be a boolean"] });
  });

  it("the desk names the profile from its name, -2 when a profile has that name, and checks the layout", async () => {
    const m = await setup(scriptedDesk, []);
    const request = { text: "make a focus profile", corrections: [] };
    expect(await m.kind.check({ id: "brain.chose", name: "Focus" }, request)).toEqual({
      value: { id: "focus-2", name: "Focus" },
    });
    const broken = await m.kind.check(
      {
        name: "Laid out",
        settings: {
          "desk.shell.mode": {
            desktops: {
              "5": { surfaces: [] },
              "1": {
                surfaces: [{ id: "radio", plugin: "endue.radio", x: 0, y: 0, w: "wide", h: 1 }],
              },
            },
          },
        },
      },
      request,
    );
    expect(broken).toEqual({
      problems: [
        "/settings/desk.shell.mode/desktops/1/surfaces/0/plugin: endue.radio is not installed",
        "/settings/desk.shell.mode/desktops/1/surfaces/0/w: must be a number",
        "/settings/desk.shell.mode/desktops/5: desktops are 1 to 4",
      ],
    });
  });

  it("with every built-in plugin installed the prompt keeps its context within brain.ask's 32000 characters", async () => {
    const all = readdirSync(join(root, "plugins")).filter((name) => {
      try {
        manifest(name);
        return true;
      } catch {
        return false;
      }
    });
    const m = await setup(scriptedDesk, [{ choice: "discard" }], all);
    await m.proposals.propose("profile", QUIET);
    const [prompt = ""] = m.prompts();
    expect(prompt.length).toBeLessThanOrEqual(ASK_LIMIT);
    expect(prompt).toContain("The desk: ");
    expect(prompt).toContain('"endue.docker":"Docker, ui, on"');
    expect(m.shown[0]?.kind).toBe("profile");
  });
});
