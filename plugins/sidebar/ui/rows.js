// The Plugins list's rows and status line, without the SDK so tests can build them. A row is a
// checkbox and the plugin's name; the list's own row stays on (there would be no way back), a failed
// plugin says why, and a plugin held off for this start only (plugin.list's heldOff) says what holds
// it. Its box still turns it on: plugin.setEnabled ends the hold.

/** What holds a plugin off for this start, as the list says it. */
export const HOLDS = {
  init: "Off for this start: init.yaml lists it in plugins.disabled",
  "safe-mode": "Off for this start: safe mode",
  quarantine: "Off for this start: it stopped an earlier start",
};

/**
 * One row for `plugin`. `self` is the list's own id; `toggle(id, on)` runs when its box changes and
 * may throw (or reject) to put the box back.
 * @param {Document} doc
 * @param {{ id: string, status: string, enabled: boolean, manifest?: { name?: string },
 *   error?: string, heldOff?: keyof typeof HOLDS }} plugin
 * @param {{ self: string, toggle: (id: string, on: boolean) => unknown }} options
 */
export function row(doc, plugin, { self, toggle }) {
  const item = doc.createElement("li");
  const label = doc.createElement("label");
  const box = doc.createElement("input");
  box.type = "checkbox";
  box.className = "desk-check";
  box.checked = plugin.enabled;
  box.disabled = plugin.status !== "ready" || plugin.id === self;
  box.addEventListener("change", async () => {
    try {
      await toggle(plugin.id, box.checked);
    } catch {
      box.checked = !box.checked;
    }
  });
  label.append(box, ` ${plugin.manifest?.name ?? plugin.id}`);
  item.append(label);
  const note =
    plugin.status === "failed"
      ? (plugin.error ?? "failed")
      : !plugin.enabled && plugin.heldOff
        ? HOLDS[plugin.heldOff]
        : undefined;
  if (note) {
    const small = doc.createElement("small");
    small.textContent = note;
    item.append(small);
  }
  return item;
}

/**
 * The status line: how many are installed and the desk's key that opens this list from any desk,
 * with the dock and the palette off too (packages/runtime/src/core/keys.ts).
 * @param {number} count
 * @param {"mac" | "other"} platform
 */
export function status(count, platform) {
  const key = platform === "mac" ? "⇧⌘X" : "Ctrl+Shift+X";
  return `${count} installed · ${key} opens this list`;
}
