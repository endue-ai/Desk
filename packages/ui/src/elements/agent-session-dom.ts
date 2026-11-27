import type { SessionCopy } from "./agent-session-copy";
import type { SessionRow } from "./agent-session-model";

export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}
export function action(label: string, fn: () => void, cls = "quiet"): HTMLButtonElement {
  const b = node("button", cls, label);
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}
export function slot(name: string) {
  const el = node("slot");
  el.name = name;
  return el;
}
export function status(row: SessionRow, c: SessionCopy): HTMLElement {
  const el = node("span", "state");
  if (row.status) {
    const signs = {
      working: "✦",
      waiting: "◐",
      failed: "!",
      done: "✓",
      stopped: "■",
      missing: "–",
    };
    el.dataset.state = row.status;
    const sign = node("span", "sign", signs[row.status]);
    sign.setAttribute("aria-hidden", "true");
    el.append(sign, c[row.status]);
  }
  return el;
}
export function restoreFocus(root: ParentNode, key: string | undefined) {
  if (key)
    Array.from(root.querySelectorAll<HTMLElement>("[data-focus]"))
      .find((el) => el.dataset.focus === key)
      ?.focus({ preventScroll: true });
}
