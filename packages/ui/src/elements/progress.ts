import { Base, element, reflect, shadow } from "./base";

const DELAY = 300;
const REDUCE = "(prefers-reduced-motion: reduce)";

const css = `
:host {
  display: block;
  box-sizing: border-box;
  min-width: 160px;
  color: var(--desk-text);
  font: inherit;
  font-size: 13px;
}
:host([hidden]) {
  display: none;
}
:host(:not([shown])) {
  visibility: hidden;
}
.label {
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.track {
  position: relative;
  flex: 1;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--desk-border);
}
.fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  border-radius: 3px;
  background: var(--desk-accent);
  color: var(--desk-background);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 120ms linear;
}
.track[data-indeterminate] .fill {
  width: 40%;
  transform: translateX(-100%);
  transition: none;
  animation: desk-progress-stripe 1.4s ease-in-out infinite;
}
.track[data-indeterminate] .fill[data-still] {
  transform: translateX(75%);
}
.fill[data-still] {
  animation: none;
  transition: none;
}
.detail {
  margin-top: 4px;
  color: var(--desk-text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
button {
  flex: none;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--desk-border);
  border-radius: 6px;
  background: var(--desk-card);
  color: var(--desk-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
button:hover {
  background: var(--desk-border);
  color: var(--desk-text);
}
button:focus-visible {
  outline: 2px solid var(--desk-accent);
  outline-offset: 1px;
}
[hidden] {
  display: none;
}
@keyframes desk-progress-stripe {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .fill {
    animation: none;
    transition: none;
  }
  .track[data-indeterminate] .fill {
    transform: translateX(75%);
  }
}
`;

/** A finite number from an attribute, or null. */
function numberOf(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `<desk-progress label value max detail delay cancelable cancel-label>`: the progress of long work.
 * `value` of `max` (1 by default, as `<progress>`) fills the bar; without `value` it is
 * indeterminate, a stripe that moves unless motion is reduced (the OS's setting, or the desk's
 * `data-motion="reduce"` on the frame's root). `detail` is a second line ("12.4 of 48.0 MB"). It
 * shows only once `delay` ms (300) have passed since it was put on the page or un-hidden, so quick
 * work shows nothing; `shown` reflects that. `cancelable` adds a Cancel button (`cancel-label`)
 * that fires `desk-cancel`. Inside, the bar is a `role="progressbar"` named by `label` with
 * `aria-valuenow`, `aria-valuemax` and `aria-valuetext` (the percentage and the detail); the button
 * sits beside it, not in it, so screen readers reach both.
 */
export class DeskProgress extends Base {
  static readonly styles = css;
  static readonly observedAttributes = [
    "label",
    "value",
    "max",
    "detail",
    "cancelable",
    "cancel-label",
    "hidden",
  ];
  readonly #label = element("div", { class: "label", part: "label", "aria-hidden": "true" });
  readonly #track = element("div", {
    class: "track",
    part: "track",
    role: "progressbar",
    "aria-valuemin": "0",
  });
  readonly #fill = element("div", { class: "fill", part: "fill" });
  readonly #cancel = element("button", { type: "button", part: "cancel", hidden: "" });
  readonly #detail = element("div", { class: "detail", part: "detail", "aria-hidden": "true" });
  #timer: ReturnType<typeof setTimeout> | undefined;
  #watch: (() => void) | undefined;

  constructor() {
    super();
    this.#track.append(this.#fill);
    const row = element("div", { class: "row" });
    row.append(this.#track, this.#cancel);
    this.#cancel.addEventListener("click", () =>
      this.dispatchEvent(new CustomEvent("desk-cancel", { bubbles: true, composed: true })),
    );
    shadow(this, css, [this.#label, row, this.#detail]);
    this.#sync();
  }

  get value(): number | null {
    return numberOf(this.getAttribute("value"));
  }

  set value(value: number | null) {
    reflect(this, "value", value === null || value === undefined ? null : String(value));
  }

  get max(): number {
    const max = numberOf(this.getAttribute("max"));
    return max !== null && max > 0 ? max : 1;
  }

  set max(value: number) {
    this.setAttribute("max", String(value));
  }

  get label(): string {
    return this.getAttribute("label") ?? "";
  }

  set label(value: string) {
    this.setAttribute("label", value);
  }

  get detail(): string {
    return this.getAttribute("detail") ?? "";
  }

  set detail(value: string) {
    reflect(this, "detail", value || null);
  }

  get cancelable(): boolean {
    return this.hasAttribute("cancelable");
  }

  set cancelable(value: boolean) {
    this.toggleAttribute("cancelable", value);
  }

  /** Whether there is no value to show, only that work goes on. */
  get indeterminate(): boolean {
    return this.value === null;
  }

  /** Whether its delay has passed, so it is drawn. */
  get shown(): boolean {
    return this.hasAttribute("shown");
  }

  connectedCallback(): void {
    this.#watchMotion();
    this.#arm();
  }

  disconnectedCallback(): void {
    clearTimeout(this.#timer);
    this.#watch?.();
    this.#watch = undefined;
    this.removeAttribute("shown");
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    if (name === "hidden") {
      if ((old === null) !== (value === null)) this.#arm();
      return;
    }
    this.#sync();
  }

  /** Start the delay over: shown once it passes, while on the page and not hidden. */
  #arm(): void {
    clearTimeout(this.#timer);
    this.removeAttribute("shown");
    if (!this.isConnected || this.hidden) return;
    const delay = numberOf(this.getAttribute("delay")) ?? DELAY;
    if (delay <= 0) this.setAttribute("shown", "");
    else this.#timer = setTimeout(() => this.setAttribute("shown", ""), delay);
  }

  #sync(): void {
    const { value, max, label, detail } = this;
    this.#label.textContent = label;
    this.#label.hidden = !label;
    this.#detail.textContent = detail;
    this.#detail.hidden = !detail;
    this.#track.setAttribute("aria-label", label || "Progress");
    this.#track.toggleAttribute("data-indeterminate", value === null);
    if (value === null) {
      this.#track.removeAttribute("aria-valuenow");
      this.#track.removeAttribute("aria-valuemax");
      reflect(this.#track, "aria-valuetext", detail || null);
      this.#fill.style.transform = "";
    } else {
      const now = Math.min(Math.max(value, 0), max);
      const percent = `${Math.floor((now / max) * 100)}%`;
      this.#track.setAttribute("aria-valuemax", String(max));
      this.#track.setAttribute("aria-valuenow", String(now));
      this.#track.setAttribute("aria-valuetext", detail ? `${percent}, ${detail}` : percent);
      this.#fill.style.transform = `scaleX(${Number((now / max).toFixed(4))})`;
    }
    this.#cancel.hidden = !this.cancelable;
    this.#cancel.textContent = this.getAttribute("cancel-label") || "Cancel";
  }

  /** Follow reduced motion: the OS's (matchMedia) and the desk's (`data-motion` on the root). */
  #watchMotion(): void {
    this.#watch?.();
    const query = typeof matchMedia === "function" ? matchMedia(REDUCE) : undefined;
    const root = typeof document === "undefined" ? undefined : document.documentElement;
    const update = () => {
      const still = query?.matches === true || root?.getAttribute("data-motion") === "reduce";
      this.#fill.toggleAttribute("data-still", still);
    };
    update();
    query?.addEventListener?.("change", update);
    const observer =
      root && typeof MutationObserver === "function" ? new MutationObserver(update) : undefined;
    observer?.observe(root as Node, { attributes: true, attributeFilter: ["data-motion"] });
    this.#watch = () => {
      query?.removeEventListener?.("change", update);
      observer?.disconnect();
    };
  }
}
