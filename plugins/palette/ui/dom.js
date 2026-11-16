// The palette page's small DOM helpers: an element with its attributes and text, and the notice
// that a command run from the palette failed.

/**
 * @param {string} tag
 * @param {Record<string, string>} [attributes]
 * @param {string} [text]
 */
export function element(tag, attributes = {}, text) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * A command run from here that failed is reported as a notice: its title, then why. A cancelled
 * one (the person backed out of a pick) is not.
 * @param {{ call: (method: string, params: unknown) => Promise<unknown> }} bridge
 * @param {string} what
 * @param {unknown} error
 */
export function reportFailure(bridge, what, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/^[^:]+: cancelled: /.test(message)) return;
  void bridge
    .call("ui.notify", {
      title: `${what} failed`,
      body: message.replace(/^[^:]+: (?:failed|unknown_command): /, ""),
      level: "error",
      scope: { permission: "ui:notify" },
    })
    .catch(() => {});
}
