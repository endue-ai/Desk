// Play mode: the slide fills the surface, Space, Right, Down and Page Down go on, Left, Up and Page
// Up go back, Home and End go to the ends, a number then Enter jumps, Escape leaves. Hidden slides
// are skipped unless jumped to. A counter shows "3 / 12".
import { scaleToFit } from "./fit.js";
import { renderSlide } from "./render/slide.js";

/** @typedef {import("./deck.js").Deck} Deck */

/**
 * @param {Document} doc
 * @param {{ left(index: number): void, say(text: string): void }} actions
 */
export function createPlayer(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const player = byId("player");
  const stage = byId("player-stage");
  const counter = byId("player-counter");
  const goto = byId("player-goto");
  /** @type {Deck | null} */
  let deck = null;
  let index = 0;
  let digits = "";

  const fitSlide = () => {
    const slide = /** @type {HTMLElement | null} */ (stage.firstElementChild);
    if (!slide || !deck) return;
    const win = doc.defaultView;
    const area = {
      width: player.clientWidth || win?.innerWidth || 0,
      height: (player.clientHeight || win?.innerHeight || 0) - 36,
    };
    const { scale, width, height } = scaleToFit(area, deck.size);
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    slide.style.transform = `scale(${scale})`;
  };
  const draw = () => {
    if (!deck) return;
    const slide = deck.slides[index];
    if (!slide) return;
    stage.replaceChildren(renderSlide(doc, deck, slide));
    counter.textContent = `${slide.number} / ${deck.slides.length}`;
    goto.textContent = "";
    fitSlide();
  };
  doc.defaultView?.addEventListener("resize", fitSlide);

  /** The next or previous slide that is not hidden, or the same one at an end. */
  const step = (/** @type {number} */ by) => {
    if (!deck) return index;
    for (let i = index + by; i >= 0 && i < deck.slides.length; i += by)
      if (!deck.slides[i]?.hidden) return i;
    return index;
  };
  const go = (/** @type {number} */ to) => {
    if (!deck || to === index || to < 0 || to >= deck.slides.length) return;
    index = to;
    draw();
  };

  const close = () => {
    if (!deck) return;
    deck = null;
    digits = "";
    player.hidden = true;
    stage.replaceChildren();
    actions.left(index);
  };
  byId("player-leave").addEventListener("click", close);
  stage.addEventListener("click", () => go(step(1)));

  return {
    isOpen: () => deck !== null,
    /** @param {Deck} which @param {number} at */
    open(which, at) {
      deck = which;
      index = Math.min(Math.max(0, at), which.slides.length - 1);
      digits = "";
      player.hidden = false;
      draw();
      player.focus();
      actions.say(`Playing from slide ${index + 1}. Escape leaves.`);
    },
    close,
    /** Handle a key in play mode; true when it was play mode's. @param {KeyboardEvent} event */
    key(event) {
      if (!deck) return false;
      const { key } = event;
      if (/^[0-9]$/.test(key)) {
        digits = (digits + key).slice(0, 5);
        goto.textContent = `Go to slide ${digits}`;
        return true;
      }
      if (key === "Enter" && digits) {
        const n = Number.parseInt(digits, 10);
        digits = "";
        goto.textContent = "";
        go(n - 1);
        return true;
      }
      if (key === "Backspace" && digits) {
        digits = digits.slice(0, -1);
        goto.textContent = digits ? `Go to slide ${digits}` : "";
        return true;
      }
      if (key === "Escape") close();
      else if ([" ", "ArrowRight", "ArrowDown", "PageDown", "Enter", "n", "N"].includes(key))
        go(step(1));
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"].includes(key))
        go(step(-1));
      else if (key === "Home") go(deck.slides.findIndex((s) => !s.hidden));
      else if (key === "End") go(deck.slides.findLastIndex((s) => !s.hidden));
      else return false;
      return true;
    },
  };
}
