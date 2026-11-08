/**
 * Eris's words under her body. Glyphs condense as each word is spoken, hold, then scatter upwards.
 * One line at a time; screen readers hear the whole sentence once through a polite live region.
 */
import type { WordTime } from "../bridge/types";
import { lineLook, nextStart, planLine, type SoulLine, type SoulStyle, wispGlyph } from "./soul";

export interface SoulOptions {
  style: () => SoulStyle;
  reduced: () => boolean;
  userName?: string;
}

const round = (n: number, d = 100) => Math.round(n * d) / d;

export class SoulText {
  readonly el: HTMLElement;
  readonly #live: HTMLElement;
  readonly #options: SoulOptions;
  #lines: { line: SoulLine; el: HTMLElement; glyphs: HTMLElement[] }[] = [];
  #count = 0;

  constructor(options: SoulOptions) {
    this.#options = options;
    this.el = document.createElement("div");
    this.el.className = "soul";
    this.el.setAttribute("aria-hidden", "true");
    this.#live = document.createElement("div");
    this.#live.className = "sr-only soul-live";
    this.#live.setAttribute("aria-live", "polite");
  }

  get live(): HTMLElement {
    return this.#live;
  }

  /** Queue a line. `lead` delays every glyph (the voice pulse needs it to reach the rim). */
  say(text: string, now: number, words?: WordTime[], lead = 0): SoulLine {
    const previous = this.#lines.at(-1)?.line;
    const start = nextStart(previous, now);
    const line = planLine(this.#count++, text, start, {
      style: this.#options.style(),
      words,
      lead,
      userName: this.#options.userName,
      reducedMotion: this.#options.reduced(),
    });
    const el = document.createElement("p");
    el.className = `soul-line soul-${line.style}`;
    el.dataset.line = String(line.n);
    const glyphs: HTMLElement[] = [];
    let k = 0;
    for (const [i, word] of text.split(/\s+/).filter(Boolean).entries()) {
      if (i > 0) el.append(" ");
      const w = document.createElement("span");
      w.className = "soul-word";
      for (const _ of word) {
        const g = line.glyphs[k++];
        if (!g) continue;
        const span = document.createElement("span");
        span.className = `soul-glyph${g.eris ? " is-eris" : ""}${g.user ? " is-user" : ""}`;
        span.textContent = g.ch;
        w.append(span);
        glyphs.push(span);
      }
      el.append(w);
    }
    el.hidden = true;
    this.el.append(el);
    this.#lines.push({ line, el, glyphs });
    return line;
  }

  /** Start scattering whatever is showing now (Eris was interrupted). */
  stop(now: number): void {
    for (const entry of this.#lines) {
      if (entry.line.dissolveAt > now) {
        const shift = entry.line.dissolveAt - now;
        entry.line = { ...entry.line, dissolveAt: now, end: entry.line.end - shift };
      }
    }
  }

  /** The sentence on screen now, for Eris's aria-label. */
  current(now: number): string {
    return this.#lines.find((e) => e.line.start <= now && now < e.line.dissolveAt)?.line.text ?? "";
  }

  update(now: number): void {
    const reduced = this.#options.reduced();
    this.#lines = this.#lines.filter((entry) => {
      if (now >= entry.line.end) {
        entry.el.remove();
        return false;
      }
      return true;
    });
    for (const { line, el, glyphs } of this.#lines) {
      const visible = now >= line.start;
      if (el.hidden === visible) {
        el.hidden = !visible;
        if (visible) this.#live.textContent = line.text;
      }
      if (!visible) continue;
      if (reduced || line.style === "solemn") {
        const look = lineLook(line, now, reduced);
        el.style.opacity = String(round(look.opacity));
        el.style.letterSpacing = `${round(look.spacing, 1000)}em`;
        continue;
      }
      line.glyphs.forEach((g, i) => {
        const span = glyphs[i];
        if (!span) return;
        const look = wispGlyph(line, g, now);
        span.style.opacity = String(round(look.opacity));
        span.style.filter = look.blur > 0.01 ? `blur(${round(look.blur)}px)` : "";
        const moved = look.x || look.y || look.rotate || look.scale !== 1;
        span.style.transform = moved
          ? `translate(${round(look.x)}px, ${round(look.y)}px) rotate(${round(look.rotate)}deg) scale(${round(look.scale, 1000)})`
          : "";
      });
    }
  }
}
