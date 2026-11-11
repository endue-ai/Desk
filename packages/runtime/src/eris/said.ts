/**
 * Her words on the desk, readable whole wherever she floats (issue 161 findings 6 and 12, issue 158
 * finding 14). A card under her, or above her when there is more room there, inside the desk with
 * 16 px to spare: a short line is soul text and leaves with it; a long one is kept as text, wrapped
 * and scrolling, until the person closes it (its button, Escape) or she says something else. "Show
 * what Eris said" (`desk.eris.said`) brings back her last lines. The card is one of the page's
 * overlays (`popover`), so the compositor draws it above every window and it takes its own presses
 * (ADR 0160, ADR 0166).
 */
import type { ShellCtx } from "../shell/context";
import { h, listen } from "../shell/dom";
import { icon } from "../shell/icons";
import { prose } from "./prose";

/** A line longer than this, or of more than one line, is kept in the card as text. */
export const KEEP_CHARS = 60;
/** How many of her lines "Show what Eris said" brings back. */
export const RECALL_LINES = 12;
export const SAID = "desk.eris.said";
const MARGIN = 16;
const GAP = 12;
const WIDTH = 480;
/** Below her unless less than this is left there and more above. */
const ROOM = 120;

const COPY = {
  en: {
    label: "What Eris said",
    close: "Close",
    title: "Show what Eris said",
    none: "Eris has said nothing yet.",
  },
  ko: {
    label: "Eris가 한 말",
    close: "닫기",
    title: "Eris가 한 말 다시 보기",
    none: "Eris가 아직 아무 말도 하지 않았어요.",
  },
} as const;

export const isLong = (text: string): boolean => {
  const line = text.trim();
  return line.length > KEEP_CHARS || line.includes("\n");
};

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placed {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

/** Where the card goes for her box on a desk of `size`. */
export function placeSaid(eris: Box, size: { width: number; height: number }): Placed {
  const width = Math.max(0, Math.min(WIDTH, size.width - 2 * MARGIN));
  const centre = eris.x + eris.width / 2;
  const left = Math.round(
    Math.max(MARGIN, Math.min(centre - width / 2, size.width - MARGIN - width)),
  );
  const below = eris.y + eris.height + GAP;
  const roomBelow = size.height - MARGIN - below;
  const roomAbove = eris.y - GAP - MARGIN;
  if (roomBelow >= ROOM || roomBelow >= roomAbove)
    return { left, top: Math.round(below), width, maxHeight: Math.max(0, Math.round(roomBelow)) };
  const bottom = Math.round(size.height - eris.y + GAP);
  return { left, bottom, width, maxHeight: Math.max(0, Math.round(roomAbove)) };
}

export interface Said {
  readonly el: HTMLElement;
  /** Her new line; true when it is kept in the card as text (the soul text is for the others). */
  say(text: string): boolean;
  /** Show the card while it keeps text or `soul` (a soul line is on screen). */
  update(soul: boolean): void;
  place(eris: Box, size: { width: number; height: number }): void;
  /** The text the card keeps now, for her label. */
  kept(): string;
  dispose(): void;
}

export function mountSaid(root: HTMLElement, ctx: ShellCtx, soul: HTMLElement): Said {
  const tr = (key: keyof (typeof COPY)["en"]) =>
    COPY[ctx.store.get().lang === "ko" ? "ko" : "en"][key];
  const text = h("div", { class: "eris-said-text", hidden: true });
  const close = h(
    "button",
    {
      class: "icon-button eris-said-close",
      type: "button",
      hidden: true,
      "aria-label": tr("close"),
      title: tr("close"),
      onClick: () => keep(null),
    },
    icon("close", 16),
  );
  const el = h(
    "section",
    { class: "popover eris-said", "aria-label": tr("label"), hidden: true },
    soul,
    text,
    close,
  );
  root.append(el);
  let lines: string[] = [];
  let kept: string[] | null = null;
  let showing = false;
  let placed = "";

  const update = (soulShown: boolean) => {
    showing = soulShown;
    el.hidden = !kept && !soulShown;
  };
  /** Keep `next` as text: an answer read from its start, her last lines from the newest. */
  const keep = (next: string[] | null, newest = false) => {
    kept = next;
    text.hidden = !next;
    close.hidden = !next;
    text.replaceChildren(...(next ?? []).flatMap((line) => prose(document, line)));
    update(showing);
    text.scrollTop = newest ? text.scrollHeight : 0;
  };
  const recall = () => keep(lines.length ? lines.slice(-RECALL_LINES) : [tr("none")], true);

  const offs = [
    listen(el, "keydown", (e) => {
      const k = e as KeyboardEvent;
      if (k.key !== "Escape" || !kept) return;
      k.preventDefault();
      k.stopPropagation();
      keep(null);
    }),
  ];
  // A shell context without commands (a test's) keeps her card all the same.
  const commands = ctx.runtime?.commands;
  if (commands)
    offs.push(
      commands.define(SAID, {
        title: tr("title"),
        owner: "desk",
        keywords: ["eris", "said", "answer", "again", "last", "history", "에리스", "답", "말"],
        run: () => recall(),
      }),
    );

  return {
    el,
    say(line) {
      const said = line.trim();
      if (said) lines = [...lines, said].slice(-RECALL_LINES);
      const long = isLong(said);
      keep(long ? [said] : null);
      return long;
    },
    update,
    place(eris, size) {
      const p = placeSaid(eris, size);
      const key = JSON.stringify(p);
      if (key === placed) return;
      placed = key;
      el.style.left = `${p.left}px`;
      el.style.width = `${p.width}px`;
      el.style.maxHeight = `${p.maxHeight}px`;
      el.style.top = p.top === undefined ? "" : `${p.top}px`;
      el.style.bottom = p.bottom === undefined ? "" : `${p.bottom}px`;
    },
    kept: () => kept?.join("\n\n") ?? "",
    dispose() {
      for (const off of offs) off();
      el.remove();
    },
  };
}
