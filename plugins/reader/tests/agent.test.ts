// @vitest-environment jsdom
// What Eris reads through Reader (ADR 0088): the open book's chapters as text with its contents, a
// run of them, which chapters hold some words, and a sentence when there is none to read.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { fb2 } from "./build/books";
import { disk, file, mount } from "./harness";

const BOOK = file("~/Books/small.fb2");
type Read = {
  units: number;
  unit: string;
  chapters: Array<{ at: number; title?: string; text: string }>;
  contents?: Array<{ title: string; at: number }>;
  more: boolean;
};

describe("an agent's reader commands", () => {
  it("reads the open book's chapters, from the first or a later one", async () => {
    const { host } = await mount({ handlers: disk({ [BOOK.path]: fb2() }) });
    await expect(host.command("endue.reader.read")).rejects.toThrow(/No book is open in Reader/);
    await host.command("desk.files.visit", BOOK);
    const first = (await host.command("endue.reader.read")) as Read;
    expect(first.unit).toBe("chapter");
    expect(first.units).toBeGreaterThanOrEqual(2);
    const all = first.chapters.map((c) => c.text).join("\n");
    expect(all).toContain("She lit the lantern at dusk.");
    expect(all).toContain("Morning came.");
    expect(first.contents?.map((c) => c.title)).toContain("Chapter One");
    const later = (await host.command("endue.reader.read", { from: 2, count: 1 })) as Read;
    expect(later.chapters.map((c) => c.at)).toEqual([2]);
    expect(later.contents).toBeUndefined();
    expect(later.more).toBe(later.units > 2);
  });

  it("finds which chapters hold some words", async () => {
    const { host } = await mount({ handlers: disk({ [BOOK.path]: fb2() }) });
    await host.command("desk.files.visit", BOOK);
    const found = (await host.command("endue.reader.find", { query: "ROAD BENT" })) as {
      found: Array<{ at: number; snippet: string }>;
    };
    expect(found.found).toHaveLength(1);
    expect(found.found[0]?.snippet).toContain("road bent east");
    await expect(host.command("endue.reader.find", { query: " " })).rejects.toThrow(/empty/);
  });

  it("are offered to agents as reads", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
    ) as PluginManifest;
    for (const id of ["endue.reader.read", "endue.reader.find"])
      expect(
        manifest.contributes?.commands?.find((c) => c.id === id),
        id,
      ).toMatchObject({
        agent: true,
        readOnly: true,
        args: { additionalProperties: false },
      });
  });
});
