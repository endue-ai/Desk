/**
 * The view of a frame that stopped answering (#39): over that surface's frame only, "Not responding"
 * with Wait and Stop, while the model (`frames/responsiveness.ts`) says it asks. The rest of the desk,
 * the window's own title bar included, keeps working. Drawing only: what Wait and Stop do is the
 * caller's. The overlay takes the focus only from its own frame, never from another window.
 */
import "./not-responding.css";

export const NOT_RESPONDING = "desk-not-responding";

/** What the overlay says and does. */
export interface NotRespondingView {
  title: string;
  line: string;
  wait: { label: string; run(): void };
  stop: { label: string; run(): void };
}

/** Show the overlay on `section` (a surface), or take it away with `undefined`. */
export function showNotResponding(section: HTMLElement, view: NotRespondingView | undefined): void {
  const shown = section.querySelector<HTMLElement>(`:scope > .${NOT_RESPONDING}`);
  if (!view) {
    shown?.remove();
    return;
  }
  if (shown) return;
  const doc = section.ownerDocument;
  const id = `${NOT_RESPONDING}-${section.dataset.surface ?? "surface"}`;
  const el = doc.createElement("div");
  el.className = NOT_RESPONDING;
  el.setAttribute("role", "alertdialog");
  el.setAttribute("aria-labelledby", `${id}-title`);
  el.setAttribute("aria-describedby", `${id}-line`);
  const title = doc.createElement("p");
  title.className = `${NOT_RESPONDING}-title`;
  title.id = `${id}-title`;
  title.textContent = view.title;
  const line = doc.createElement("p");
  line.className = `${NOT_RESPONDING}-line`;
  line.id = `${id}-line`;
  line.textContent = view.line;
  const actions = doc.createElement("div");
  actions.className = `${NOT_RESPONDING}-actions`;
  const wait = doc.createElement("button");
  wait.type = "button";
  wait.className = "btn";
  wait.textContent = view.wait.label;
  wait.addEventListener("click", () => view.wait.run());
  const stop = doc.createElement("button");
  stop.type = "button";
  stop.className = "btn btn-danger";
  stop.textContent = view.stop.label;
  stop.addEventListener("click", () => view.stop.run());
  actions.append(wait, stop);
  const card = doc.createElement("div");
  card.className = `${NOT_RESPONDING}-card`;
  card.append(title, line, actions);
  el.append(card);
  // Had its frame the focus, the keys go to the question: they would go nowhere else.
  const focused = section.contains(doc.activeElement);
  section.append(el);
  if (focused) wait.focus();
}
