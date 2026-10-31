// Helpers for tests that read the deck model: open bytes as a deck, and read text out of elements.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Deck, Element, Slide, TextBody } from "../ui/deck.js";
import { openFile } from "../ui/open.js";

export const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

/** Open bytes as `name` and expect a deck. */
export async function deckOf(bytes: Uint8Array, name: string): Promise<Deck> {
  const opened = await openFile(bytes, name);
  if (opened.kind !== "deck") throw new Error(`expected a deck, got ${JSON.stringify(opened)}`);
  return opened.deck;
}

export const bodyText = (body: TextBody | null | undefined) =>
  (body?.paragraphs ?? []).map((p) => p.runs.map((r) => r.text).join("")).join("\n");

/** Every element, groups' children included, depth first. */
export function flat(elements: Element[] = []): Element[] {
  return elements.flatMap((e) => (e.type === "group" ? [e, ...flat(e.children)] : [e]));
}

/** All the text on a slide, one line per paragraph, tables included. */
export function slideText(slide: Slide | undefined): string {
  const lines: string[] = [];
  for (const e of flat(slide?.elements)) {
    if (e.type === "shape" && e.text) lines.push(bodyText(e.text));
    if (e.type === "table")
      for (const row of e.rows) for (const cell of row.cells) lines.push(bodyText(cell.text));
  }
  return lines.filter(Boolean).join("\n");
}

export const shapes = (slide: Slide | undefined) =>
  flat(slide?.elements).filter((e): e is Extract<Element, { type: "shape" }> => e.type === "shape");
