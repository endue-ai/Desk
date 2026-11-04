// The repositories opened before, most recent first, kept in the plugin's store, and the pick that
// offers them when Git: status names no folder.

const RECENT_KEY = "recent";

/** The last segment of a path: `/Users/me/Project/Desk` → `Desk`. */
export function nameOf(/** @type {string} */ path) {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @param {() => number} max How many to keep (the recentMax setting).
 * @param {(title: string, items: Array<{ id: string, label: string, detail?: string }>, free?: boolean, placeholder?: string) => Promise<string | undefined>} pick
 */
export function createRecent(bridge, max, pick) {
  const recentRepos = async () => {
    const kept = await bridge.call("store.get", { key: RECENT_KEY }).catch(() => ({}));
    const value = /** @type {{ value?: unknown }} */ (kept).value;
    return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
  };
  return {
    /** Put `root` first. @param {string} root */
    remember: async (root) => {
      const list = await recentRepos();
      const next = [root, ...list.filter((path) => path !== root)].slice(0, max());
      await bridge.call("store.set", { key: RECENT_KEY, value: next }).catch(() => {});
    },
    pickRepo: async () => {
      const items = (await recentRepos()).map((p) => ({ id: p, label: nameOf(p), detail: p }));
      return pick("Git: which repository?", items, true, "a folder path");
    },
  };
}
