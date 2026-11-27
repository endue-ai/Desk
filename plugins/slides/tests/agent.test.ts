// @vitest-environment jsdom
// What Eris reads through Slides (ADR 0088): the open deck slide by slide, its text and speaker
// notes, a run of slides, and a sentence when there is none to read.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { disk, file, mount } from "./harness";
import { pptx, title } from "./pptx";

const A = file("~/Decks/a.pptx");
const deck = pptx([
  { shapes: title("Alpha"), notes: "Say hello" },
  { shapes: title("Beta") },
  { shapes: title("Gamma") },
]);

type Read = {
  total: number;
  slides: Array<{ number: number; title: string; text: string; notes: string }>;
  more: boolean;
};

describe("endue.slides.read", () => {
  it("reads the open deck's slides with their notes, and a run of them", async () => {
    const { host } = await mount({ handlers: disk({ [A.path]: deck }) });
    await expect(host.command("endue.slides.read")).rejects.toThrow(/No deck is open in Slides/);
    await host.command("desk.files.visit", A);
    const all = (await host.command("endue.slides.read")) as Read;
    expect(all.total).toBe(3);
    expect(all.slides.map((s) => [s.number, s.title])).toEqual([
      [1, "Alpha"],
      [2, "Beta"],
      [3, "Gamma"],
    ]);
    expect(all.slides[0]?.text).toContain("Alpha");
    expect(all.slides[0]?.notes).toContain("Say hello");
    expect(all.more).toBe(false);
    const run = (await host.command("endue.slides.read", { from: 2, count: 1 })) as Read;
    expect(run.slides.map((s) => s.title)).toEqual(["Beta"]);
    expect(run.more).toBe(true);
  });

  it("reports the slide on screen for the open deck", async () => {
    const { host, view } = await mount({ handlers: disk({ [A.path]: deck }) });
    await host.command("desk.files.visit", A);
    view.at[A.buffer] = 1;
    expect(await host.command("endue.slides.read")).toMatchObject({ slide: 2 });
  });

  it("is offered to agents as a read", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
    ) as PluginManifest;
    const read = manifest.contributes?.commands?.find((c) => c.id === "endue.slides.read");
    expect(read).toMatchObject({
      agent: true,
      readOnly: true,
      args: { additionalProperties: false },
    });
  });
});
