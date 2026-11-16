/**
 * Eris at rest is in the talk line (ADR 0254): the pill's small orb stands for her, and the large
 * orb comes out above the pill only while she is at work (a state other than idle, a spoken turn
 * listening, thinking or speaking, her words showing, or a drag), going back `RETURN_MS` after none
 * of these holds. A place of her own (a profile's, or one the person dragged her to) keeps her
 * there in sight, as does a desk with no talk pill (a plugin holds the dock's role): she rests at
 * the top centre then, as before. At rest she stays in the DOM, hidden once her leave is over
 * (`eris.css`), out of the tab order and of the accessibility tree.
 */
import type { TalkPhase } from "./talk";

/** How long after she is done the large orb waits before it goes back into the pill. */
export const RETURN_MS = 1200;
/** The space between her box and the pill. */
const GAP = 12;
const TURN: ReadonlySet<TalkPhase> = new Set(["listening", "thinking", "speaking"]);

export interface Work {
  state: string;
  phase: TalkPhase;
  /** Her soul text on screen, or a long line kept in her card. */
  words: boolean;
  dragging: boolean;
}

/** Whether she is at work: then the large orb is out. */
export const atWork = (w: Work) => w.state !== "idle" || TURN.has(w.phase) || w.words || w.dragging;

/** The wait between her work and the pill, on the frames' clock. */
export class Rest {
  #out = false;
  #since: number | undefined;
  /** Her first frame comes before the bottom edge mounts (Desk.ts): she takes the pill is coming,
   * so the page never draws her out at load; the next frame sees whether it is there. */
  #first = true;

  /**
   * Whether she rests in the pill at `now`. With a place of her own (`own`) or no pill she never
   * rests in it, and comes back from nothing.
   */
  resting(own: boolean, pill: boolean, working: boolean, now: number): boolean {
    const home = !own && (pill || this.#first);
    this.#first = false;
    if (!home || working) {
      this.#out = home;
      this.#since = undefined;
      return false;
    }
    if (!this.#out) return true;
    this.#since ??= now;
    if (now - this.#since < RETURN_MS) return false;
    this.#out = false;
    this.#since = undefined;
    return true;
  }

  /** Whether she is out and waiting to go back: her frames must run until she does. */
  get waiting(): boolean {
    return this.#since !== undefined;
  }
}

/** The talk pill in her root, unless a plugin holds the dock's role (roles.ts yields the bottom). */
export function pillOf(root: HTMLElement): HTMLElement | null {
  const pill = root.querySelector<HTMLElement>(".talk-pill");
  return pill && !pill.closest("[data-role-yielded]") ? pill : null;
}

type Box = { left: number; top: number; width: number; height: number };

/**
 * Where she stands over the pill: centred on it with `GAP` between, above it, or under it when it
 * sits high up (`is-high`, talk-place.ts). In her root's coordinates.
 */
export function overPill(
  pill: HTMLElement,
  root: HTMLElement,
  body: { width: number; height: number },
) {
  const p: Box = pill.getBoundingClientRect();
  const r: Box = root.getBoundingClientRect();
  const x = p.left - r.left + p.width / 2 - body.width / 2;
  const y = pill.classList.contains("is-high")
    ? p.top - r.top + p.height + GAP
    : p.top - r.top - GAP - body.height;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Her place with none of her own: over the pill, or `top` (the top centre) with no pill. */
export function homeOf(
  root: HTMLElement,
  body: { width: number; height: number },
  top: { x: number; y: number },
) {
  const pill = pillOf(root);
  return pill ? overPill(pill, root, body) : { x: Math.round(top.x), y: top.y };
}

/** Draw her resting or out: hidden from the pointer, the keyboard and the accessibility tree. */
export function showRest(el: HTMLElement, resting: boolean, reduced: boolean): void {
  if (el.classList.contains("is-resting") !== resting) el.classList.toggle("is-resting", resting);
  if (reduced) el.dataset.motion = "none";
  else delete el.dataset.motion;
  el.tabIndex = resting ? -1 : 0;
  if (resting) {
    el.setAttribute("aria-hidden", "true");
    if (el.ownerDocument.activeElement === el) el.blur();
  } else el.removeAttribute("aria-hidden");
}

/** Wake her when her card shows or hides on its own (its close button, `desk.eris.said`). */
export function watchCard(card: HTMLElement, wake: () => void): () => void {
  const seen = new MutationObserver(wake);
  seen.observe(card, { attributes: true, attributeFilter: ["hidden"] });
  return () => seen.disconnect();
}
