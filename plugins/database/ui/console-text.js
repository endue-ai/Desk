// A console's text in the plugin's store: kept a moment after each change (the first 60 KB, and
// the person is told when it is cut), kept at once when another console's text changes, and read
// back when its console opens. No DOM.

const TEXT_LIMIT = 60 * 1024;
const textKey = (/** @type {string} */ connection) => `console:${connection}`;

/**
 * @param {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   view: { say(text: string): void },
 * }} deps
 */
export function createTexts({ bridge, view }) {
  /** The console text waiting to be kept, and its timer. */
  /** @type {{ connection: string, text: string, timer: ReturnType<typeof setTimeout> } | null} */
  let saving = null;
  const keep = () => {
    if (!saving) return;
    clearTimeout(saving.timer);
    const { connection, text } = saving;
    saving = null;
    if (text.length > TEXT_LIMIT) view.say("Only the first 60 KB of this console is kept");
    void bridge
      .call("store.set", { key: textKey(connection), value: text.slice(0, TEXT_LIMIT) })
      .catch(() => view.say("Could not save this console."));
  };

  return {
    /** The text kept for a connection's console, or "". */
    async load(/** @type {string} */ connection) {
      const kept = await bridge.call("store.get", { key: textKey(connection) }).catch(() => ({}));
      return typeof kept.value === "string" ? kept.value : "";
    },
    /** A console's text changed: keep it, a moment later. */
    edited(/** @type {string} */ connection, /** @type {string} */ text) {
      if (saving && saving.connection !== connection) keep();
      if (saving) clearTimeout(saving.timer);
      saving = { connection, text, timer: setTimeout(keep, 400) };
    },
  };
}
