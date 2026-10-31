// The thumbnail rail: one button per slide with its number, its title as its name, a hidden mark,
// and a thumbnail drawn when it scrolls into view, the rest a few at a time in the background (a
// hidden page never reports what is in view). Only the current button is in the tab order.
import { renderSlide } from "./render/slide.js";

/** @typedef {import("./deck.js").Deck} Deck */

const THUMB_WIDTH = 132;

/** @param {Document} doc @param {HTMLElement} list @param {(index: number) => void} pick */
export function createRail(doc, list, pick) {
  /** @type {HTMLButtonElement[]} */
  let buttons = [];
  const Observer = doc.defaultView?.IntersectionObserver;
  /** @type {IntersectionObserver | null} */
  let observer = null;
  /** @type {Map<Element, () => void>} */
  const pending = new Map();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const drawSome = () => {
    let n = 0;
    for (const [thumb, draw] of pending) {
      if (n++ >= 4) break;
      pending.delete(thumb);
      observer?.unobserve(thumb);
      draw();
    }
    timer = pending.size ? setTimeout(drawSome, 60) : undefined;
  };

  return {
    /** @param {Deck | null} deck */
    build(deck) {
      observer?.disconnect();
      clearTimeout(timer);
      pending.clear();
      list.replaceChildren();
      buttons = [];
      if (!deck) return;
      const scale = THUMB_WIDTH / (deck.size.width || 1);
      if (Observer) {
        observer = new Observer(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              pending.get(entry.target)?.();
              pending.delete(entry.target);
              observer?.unobserve(entry.target);
            }
          },
          { root: list.parentElement, rootMargin: "400px 0px" },
        );
      }
      deck.slides.forEach((slide, i) => {
        const item = doc.createElement("li");
        const button = doc.createElement("button");
        button.type = "button";
        button.tabIndex = -1;
        const title = slide.title || "untitled";
        button.setAttribute(
          "aria-label",
          `Slide ${i + 1}: ${title}${slide.hidden ? ", hidden" : ""}`,
        );
        if (slide.hidden) button.classList.add("is-hidden");
        const number = doc.createElement("span");
        number.className = "number";
        number.textContent = String(i + 1);
        const thumb = doc.createElement("span");
        thumb.className = "thumb";
        thumb.setAttribute("aria-hidden", "true");
        thumb.style.width = `${THUMB_WIDTH}px`;
        thumb.style.height = `${deck.size.height * scale}px`;
        const draw = () => {
          const drawn = renderSlide(doc, deck, slide);
          drawn.style.transform = `scale(${scale})`;
          thumb.replaceChildren(drawn);
        };
        if (observer) {
          pending.set(thumb, draw);
          observer.observe(thumb);
        } else draw();
        button.append(number, thumb);
        button.addEventListener("click", () => pick(i));
        item.append(button);
        list.append(item);
        buttons.push(button);
      });
      if (pending.size) timer = setTimeout(drawSome, 300);
    },
    /** Mark the current slide; move the focus with it when the focus is in the rail. @param {number} index */
    select(index) {
      const inRail = buttons.some((b) => b === doc.activeElement);
      buttons.forEach((button, i) => {
        const current = i === index;
        button.tabIndex = current ? 0 : -1;
        if (current) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
      });
      const button = buttons[index];
      if (!button) return;
      if (inRail) button.focus();
      button.scrollIntoView?.({ block: "nearest" });
    },
  };
}
