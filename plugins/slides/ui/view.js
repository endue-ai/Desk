// The DOM for the slides plugin: the header (name, format, count, Play), the rail, the slide on screen
// scaled to fit with its notes under it, play mode, the details view, and a status live region.
// Arrows, Page Up/Down, Home and End move between slides; F5 plays from the start and Shift+F5 from
// the slide on screen. Chords (Mod+S, Mod+O, Mod+W, Mod+K) are never prevented.
import { renderDetails } from "./details.js";
import { scaleToFit } from "./fit.js";
import { createPlayer } from "./play.js";
import { createRail } from "./rail.js";
import { renderSlide } from "./render/slide.js";

/**
 * @typedef {import("./slides.js").Shown} Shown
 * @typedef {import("./deck.js").Deck} Deck
 */

/** Whether a key press belongs to a text field. @param {EventTarget | null} target */
const typing = (target) => {
  const el = /** @type {HTMLElement | null} */ (target);
  return Boolean(
    el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)),
  );
};

/** @param {Document} doc */
export function createView(doc) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const name = byId("deck-name");
  const format = byId("deck-format");
  const count = byId("deck-count");
  const badge = byId("deck-badge");
  const play = /** @type {HTMLButtonElement} */ (byId("play"));
  const main = byId("deck");
  const stage = byId("stage");
  const frame = byId("slide-frame");
  const notes = byId("notes-text");
  const details = byId("details");
  const status = byId("status");
  /** @type {Deck | null} */
  let deck = null;
  /** @type {string | null} */
  let buffer = null;
  let index = 0;
  /** Where each open file was left. @type {Map<string, number>} */
  const positions = new Map();

  const say = (/** @type {string} */ text) => {
    status.textContent = text;
  };
  const fitSlide = () => {
    const slide = /** @type {HTMLElement | null} */ (frame.firstElementChild);
    if (!slide || !deck) return;
    const pad = stage.clientWidth > 320 ? 24 : 4;
    const area = {
      width: Math.max(1, stage.clientWidth - pad),
      height: Math.max(1, stage.clientHeight - pad),
    };
    const { scale, width, height } = scaleToFit(area, deck.size);
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    slide.style.transform = `scale(${scale})`;
  };
  const Resize = doc.defaultView?.ResizeObserver;
  if (Resize) new Resize(fitSlide).observe(stage);

  const rail = createRail(doc, byId("rail"), (i) => go(i));
  const player = createPlayer(doc, {
    left: (at) => {
      go(at);
      stage.focus();
      say(`Left play mode at slide ${at + 1}.`);
    },
    say,
  });

  /** Show slide i of the deck on screen. @param {number} i */
  function go(i) {
    if (!deck) return;
    index = Math.min(Math.max(0, i), deck.slides.length - 1);
    if (buffer) positions.set(buffer, index);
    const slide = deck.slides[index];
    if (!slide) return;
    frame.replaceChildren(renderSlide(doc, deck, slide));
    frame.style.aspectRatio = `${deck.size.width} / ${deck.size.height}`;
    fitSlide();
    stage.setAttribute("aria-label", `Slide ${index + 1} of ${deck.slides.length}`);
    notes.textContent = slide.notes;
    rail.select(index);
  }

  const startPlay = (/** @type {number} */ from) => {
    if (!deck || deck.slides.length === 0) return;
    const first = deck.slides.findIndex((s) => !s.hidden);
    player.open(deck, from < 0 ? Math.max(0, first) : from);
  };
  play.addEventListener("click", () => startPlay(index));

  doc.addEventListener("keydown", (event) => {
    // A view whose page was replaced (a test's, or a reload's) no longer answers.
    if (event.metaKey || event.ctrlKey || event.altKey || !stage.isConnected) return;
    if (player.isOpen()) {
      if (player.key(event)) event.preventDefault();
      return;
    }
    if (!deck || typing(event.target)) return;
    const { key, shiftKey } = event;
    if (key === "F5") startPlay(shiftKey ? index : -1);
    else if (shiftKey) return;
    else if (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown") go(index + 1);
    else if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") go(index - 1);
    else if (key === "Home") go(0);
    else if (key === "End") go(deck.slides.length - 1);
    else return;
    event.preventDefault();
  });

  return {
    /** @param {Shown | null} model */
    show(model) {
      if (player.isOpen()) player.close();
      const opened = model?.opened;
      deck = opened?.kind === "deck" ? opened.deck : null;
      buffer = model?.buffer ?? null;
      name.textContent = model ? model.name : "No presentation open";
      format.textContent = opened ? opened.format : "";
      count.textContent = deck
        ? `${deck.slides.length} ${deck.slides.length === 1 ? "slide" : "slides"}`
        : "";
      badge.hidden = !deck?.textOnly;
      play.hidden = !deck || deck.slides.length === 0;
      main.hidden = !deck;
      details.hidden = !model || Boolean(deck);
      rail.build(deck);
      frame.replaceChildren();
      notes.textContent = "";
      if (model && !deck) renderDetails(doc, details, model);
      else details.replaceChildren();
      if (deck) go(positions.get(model?.buffer ?? "") ?? 0);
    },
    /** @param {string} text */
    status: say,
    focus() {
      if (deck) stage.focus();
      else if (!details.hidden) details.focus();
    },
  };
}
