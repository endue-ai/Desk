/**
 * What stands in a surface while its frame is unloaded (ADR 0070): its title, a line saying it
 * loads again when shown, and Reload, which loads it now. Usually covered or off the page; pressing
 * it loads the surface. On the compositor its window shows its last frame greyed under the same
 * words, Reload running desk.frames.reload (#54). A frame the person stopped (#39) stays unloaded in
 * sight: its placeholder says why and offers Reload alone.
 */
export const PLACEHOLDER = "desk-surface-placeholder";

export function placeholder(
  doc: Document,
  title: string,
  wake: () => void,
  reload = "Reload",
): HTMLElement {
  const el = doc.createElement("div");
  el.className = PLACEHOLDER;
  const name = doc.createElement("p");
  name.className = `${PLACEHOLDER}-title`;
  name.textContent = title;
  const line = doc.createElement("p");
  line.textContent = "Unloaded while out of sight. It loads again when shown.";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "btn desk-surface-reload";
  button.textContent = reload;
  el.append(name, line, button);
  el.addEventListener("pointerdown", wake);
  return el;
}

/** What a stopped frame's placeholder says: its title, why it stopped, and the Reload button's label. */
export interface StoppedText {
  title: string;
  line: string;
  reload: string;
}

/** A stopped frame's placeholder: only its Reload button loads the frame again. */
export function stoppedPlaceholder(
  doc: Document,
  text: StoppedText,
  reload: () => void,
): HTMLElement {
  const el = doc.createElement("div");
  el.className = `${PLACEHOLDER} ${PLACEHOLDER}--stopped`;
  const name = doc.createElement("p");
  name.className = `${PLACEHOLDER}-title`;
  name.textContent = text.title;
  const line = doc.createElement("p");
  line.textContent = text.line;
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary desk-surface-reload";
  button.textContent = text.reload;
  button.addEventListener("click", reload);
  el.append(name, line, button);
  return el;
}
