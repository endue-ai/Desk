// Puts the plugin's index.html into the jsdom document, without its scripts, for view tests.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Deck, Slide } from "../ui/deck.js";

export function loadPage(): Document {
  const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
  const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
  return document;
}

export const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = document) => {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const slide = (n: number, notes: string, hidden = false): Slide => ({
  number: n,
  title: `Slide ${n} title`,
  hidden,
  notes,
  background: { type: "solid", color: "#ffffff" },
  elements: [
    {
      type: "shape",
      name: `Title ${n}`,
      placeholder: "title",
      box: { x: 40, y: 20, w: 880, h: 80, rot: 0, flipH: false, flipV: false },
      geometry: { name: "rect", adjust: {} },
      fill: { type: "none" },
      line: null,
      text: {
        anchor: "top",
        inset: { left: 7.2, top: 3.6, right: 7.2, bottom: 3.6 },
        wrap: true,
        vertical: "horz",
        scale: 1,
        lineReduction: 0,
        paragraphs: [
          {
            align: "left",
            level: 0,
            marginLeft: 0,
            indent: 0,
            bullet: null,
            spaceBefore: 0,
            spaceAfter: 0,
            lineSpacing: 1,
            lineExact: 0,
            size: 32,
            runs: [
              {
                text: `Slide ${n} title`,
                size: 32,
                bold: false,
                italic: false,
                underline: false,
                strike: false,
                color: "#000000",
                font: "Georgia",
                baseline: 0,
              },
            ],
          },
        ],
      },
    },
  ],
});

/** Three 16:9 slides with notes; the third is hidden when asked. */
export const deck = (hiddenThird = false): Deck => ({
  format: "PowerPoint presentation",
  size: { width: 960, height: 540 },
  textOnly: false,
  slides: [slide(1, "First notes"), slide(2, "Second notes"), slide(3, "", hiddenThird)],
  image: async () => null,
});
