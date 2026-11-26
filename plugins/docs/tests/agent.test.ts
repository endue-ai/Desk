// What Eris reads through Docs (ADR 0088): the document on screen, or another open one, as text,
// a part of a long one, and a sentence when there is none to read.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { documentText } from "../ui/agent.js";
import { disk, file, mount } from "./harness";
import { utf8 } from "./zip";

const A = file("~/Documents/a.rtf");
const B = file("~/Documents/b.rtf");
const rtf = (text: string) => utf8(`{\\rtf1\\ansi ${text}\\par}`);

describe("endue.docs.read", () => {
  it("reads the document on screen, another open one by path, and a part of either", async () => {
    const { host } = await mount({
      handlers: disk({ [A.path]: rtf("Alpha beta"), [B.path]: rtf("Gamma") }),
    });
    await expect(host.command("endue.docs.read")).rejects.toThrow(/No document is open in Docs/);
    await host.command("desk.files.visit", A);
    await host.command("desk.files.visit", B);
    const shown = (await host.command("endue.docs.read")) as Record<string, unknown>;
    expect(shown).toMatchObject({
      path: B.path,
      text: "Gamma",
      more: false,
      format: "Rich Text Format",
    });
    expect(shown.documents).toEqual([
      { path: A.path, name: "a.rtf", onScreen: false },
      { path: B.path, name: "b.rtf", onScreen: true },
    ]);
    const part = await host.command("endue.docs.read", { path: A.path, from: 6, chars: 2 });
    expect(part).toMatchObject({ path: A.path, text: "be", from: 6, length: 10, more: true });
    await expect(host.command("endue.docs.read", { path: "~/x.rtf" })).rejects.toThrow(
      /Docs has no ~\/x.rtf open/,
    );
  });

  it("reports the page on screen for the active document", async () => {
    const { host, view } = await mount({ handlers: disk({ [A.path]: rtf("Fixture") }) });
    await host.command("desk.files.visit", A);
    view.here = { at: { page: 0, down: 0.2, across: 0 }, zoom: 1.25 };
    expect(await host.command("endue.docs.read")).toMatchObject({ page: 1, zoom: 1.25 });
  });

  it("marks headings, list items, table rows, notes and comments", () => {
    const text = documentText({
      kind: "document",
      format: "docx",
      formatName: "Word",
      textOnly: false,
      title: "Plan",
      sections: [
        {
          width: 612,
          height: 792,
          margins: { top: 0, right: 0, bottom: 0, left: 0 },
          header: [],
          footer: [],
          blocks: [
            { type: "paragraph", level: 1, inlines: [{ type: "text", text: "Plan" }] },
            {
              type: "paragraph",
              marker: "•",
              inlines: [
                { type: "text", text: "Ship" },
                { type: "noteref", note: "n1", label: "1" },
              ],
            },
            {
              type: "table",
              borders: true,
              rows: [
                {
                  cells: [
                    {
                      colSpan: 1,
                      rowSpan: 1,
                      blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "a|b" }] }],
                    },
                    {
                      colSpan: 1,
                      rowSpan: 1,
                      blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "c" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      notes: [
        {
          id: "n1",
          kind: "footnote",
          label: "1",
          blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "Soon" }] }],
        },
      ],
      comments: [
        {
          id: "c1",
          author: "Ada",
          date: "2026-11-01",
          blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "OK?" }] }],
        },
      ],
    });
    expect(text.split("\n")).toEqual([
      "# Plan",
      "• Ship[1]",
      "| a\\|b | c |",
      "",
      "",
      "---",
      "Notes:",
      "[1] Soon",
      "",
      "---",
      "Comments:",
      "Ada (2026-11-01): OK?",
    ]);
  });

  it("is offered to agents as a read", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
    ) as PluginManifest;
    const read = manifest.contributes?.commands?.find((c) => c.id === "endue.docs.read");
    expect(read).toMatchObject({
      agent: true,
      readOnly: true,
      args: { additionalProperties: false },
    });
  });
});
