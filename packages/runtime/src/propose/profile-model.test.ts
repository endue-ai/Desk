import type { PluginInfo, ProfileContribution, SettingContribution } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { profileModel, profileProblems } from "./profile-model";

const plugin = (id: string, name: string): PluginInfo =>
  ({ id, enabled: true, status: "ready", manifest: { id, name } }) as unknown as PluginInfo;
const installed = [plugin("endue.notes", "Notes"), plugin("endue.calendar", "Calendar")];
const declared: Record<string, SettingContribution> = {
  "desk.shell.mode": { kind: "object", default: {} },
};
const settings = { get: () => undefined, layer: () => ({}) } as never;
const window = (id: string, plugin: string) => ({ id, plugin, x: 100, y: 120, w: 400, h: 300 });
const named = (names: string[], layouts: Record<number, ReturnType<typeof window>[]> = {}) =>
  names.map((name, i) => ({
    id: String(i + 1),
    name,
    ...(layouts[i] ? { layout: { surfaces: layouts[i] } } : {}),
  }));
const proposal = (desktops: unknown): ProfileContribution => ({
  id: "research",
  name: "Research",
  settings: { "desk.shell.mode": { desktops } },
});

describe("Eris's profile proposals with named desktops", () => {
  it("validate with more than four named desktops", () => {
    const six = named(["Mail", "Read", "Write", "Code", "Plan", "Rest"], {
      5: [window("notes", "endue.notes")],
    });
    expect(profileProblems(proposal(six), installed, declared)).toEqual([]);
  });

  it("show each desktop's windows in the ghost by position", () => {
    const six = named(["Mail", "Read", "Write", "Code", "Plan", "Rest"], {
      1: [window("calendar", "endue.calendar")],
      5: [window("notes", "endue.notes")],
    });
    const model = profileModel(proposal(six), { installed, turnedOff: [], settings, declared });
    expect(model.desktops.map((d) => [d.desktop, d.windows.map((w) => w.title)])).toEqual([
      [2, ["Calendar"]],
      [6, ["Notes"]],
    ]);
  });

  it("still take the four desktops by number, as before", () => {
    const four = { "2": { surfaces: [window("notes", "endue.notes")] } };
    expect(profileProblems(proposal(four), installed, declared)).toEqual([]);
    const model = profileModel(proposal(four), { installed, turnedOff: [], settings, declared });
    expect(model.desktops.map((d) => d.desktop)).toEqual([2]);
  });

  it("say what is wrong: an empty list, too many, a layout out of shape", () => {
    const at = "/settings/desk.shell.mode/desktops";
    expect(profileProblems(proposal([]), installed, declared)).toEqual([
      `${at}: must have at least one desktop`,
    ]);
    const many = Array.from({ length: 33 }, (_, i) => ({ id: String(i + 1), name: String(i + 1) }));
    expect(profileProblems(proposal(many), installed, declared)).toEqual([
      `${at}: at most 32 desktops`,
    ]);
    expect(
      profileProblems(
        proposal([{ id: "a", name: "A", layout: { surfaces: "x" } }]),
        installed,
        declared,
      ),
    ).toEqual([`${at}/0/layout/surfaces: must be an array`]);
    expect(profileProblems(proposal("all of them"), installed, declared)).toEqual([
      `${at}: must be a list of desktops`,
    ]);
  });
});
