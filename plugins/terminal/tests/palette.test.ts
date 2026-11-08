import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PaletteResult, PluginManifest } from "../../../packages/bridge/src/index";
import { mount } from "./harness";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Ajv over specs/plugin/v0 and the specs it references, for PaletteResults. */
function paletteResults() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema(
    "https://endue.ai/specs/plugin/v0/contributes.schema.json#/$defs/PaletteResults",
  );
  if (!validate) throw new Error("cannot compile PaletteResults");
  return validate;
}

type Answer = { results: PaletteResult[] };

const focus = (session: string) => [
  { command: "endue.terminal.focus", title: "Focus the terminal", args: { session } },
];

/** The terminal with two tabs: t-1 renamed "build server" in ~, t-2 on screen in ~/repo. */
const twoTabs = async () => {
  const mounted = await mount();
  await mounted.host.command("endue.terminal.rename", { session: "t-1", title: "build server" });
  await mounted.host.command("endue.terminal.new", { cwd: "~/repo" });
  await mounted.settle();
  return mounted;
};

describe("the palette's Terminals provider", () => {
  it("contributes the Terminals provider for endue.terminal.tabs", () => {
    const manifest = readJson(join(root, "plugins/terminal/plugin.json")) as PluginManifest;
    expect(manifest.contributes?.paletteProviders).toEqual([
      { command: "endue.terminal.tabs", title: "Terminals" },
    ]);
    expect(manifest.contributes?.commands?.map((c) => c.id)).toContain("endue.terminal.tabs");
  });

  it("answers the open terminals that hold the typed words", async () => {
    const { host, settle } = await twoTabs();
    const valid = paletteResults();
    const all = (await host.command("endue.terminal.tabs", { query: "term", limit: 5 })) as Answer;
    expect(valid(all), JSON.stringify(valid.errors)).toBe(true);
    expect(all.results).toEqual([
      {
        id: "t-1",
        title: "build server",
        detail: "zsh · ~",
        kind: "terminal",
        actions: focus("t-1"),
      },
      {
        id: "t-2",
        title: "zsh",
        detail: "zsh · ~/repo · on screen",
        kind: "terminal",
        actions: focus("t-2"),
      },
    ]);

    const ask = async (query: string, limit = 5) =>
      ((await host.command("endue.terminal.tabs", { query, limit })) as Answer).results.map(
        (r) => r.id,
      );
    expect(await ask("BUILD")).toEqual(["t-1"]);
    expect(await ask("zsh repo")).toEqual(["t-2"]);
    expect(await ask("zsh")).toEqual(["t-1", "t-2"]);
    expect(await ask("terminal", 1)).toEqual(["t-1"]);
    expect(await ask("nothing")).toEqual([]);
    expect(await ask("  ")).toEqual([]);

    // A terminal whose program ended is still a tab to go to.
    host.emit({ event: "proc.exit", data: { procId: "p1", code: 0 } });
    await settle();
    const ended = (await host.command("endue.terminal.tabs", { query: "build" })) as Answer;
    expect(valid(ended), JSON.stringify(valid.errors)).toBe(true);
    expect(ended.results[0]).toMatchObject({ id: "t-1", detail: "zsh · ~ · ended" });
  });

  it("a pick runs endue.terminal.focus on the chosen terminal", async () => {
    const { host, view } = await twoTabs();
    const answer = (await host.command("endue.terminal.tabs", {
      query: "build",
      limit: 5,
    })) as Answer;
    const action = answer.results[0]?.actions[0];
    expect(action).toEqual(focus("t-1")[0]);
    if (!action) return;
    expect(await host.command(action.command, action.args)).toBe("t-1");
    expect(view.shown.at(-1)).toBe("t-1");
    expect(view.focused.at(-1)).toBe("t-1");
  });
});
