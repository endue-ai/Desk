// Resolve a saved connection by ID or name, or show the same connection picker used by commands.
import { engineOf } from "./engines/index.js";
import { t } from "./strings/index.js";

/** @typedef {import("./engines/common.js").Connection} Connection */

/** @param {Connection[]} list @param {string} ref */
export function findConnection(list, ref) {
  return (
    list.find((c) => c.id === ref) ?? list.find((c) => c.name.toLowerCase() === ref.toLowerCase())
  );
}

/**
 * @param {() => Connection[]} current
 * @param {import("./manage.js").Deps["pick"]} pick
 * @param {string | undefined} ref
 * @param {string} title
 */
export async function chooseConnection(current, pick, ref, title) {
  const list = current();
  if (ref) {
    const found = findConnection(list, ref);
    if (!found) throw new Error(t("manage.noConnectionIsNamed", { ref }));
    return found;
  }
  if (list.length === 0) throw new Error(t("manage.noConnectionsYetAddOneWith"));
  if (list.length === 1) return /** @type {Connection} */ (list[0]);
  const items = list.map((c) => ({
    id: c.id,
    label: c.name,
    detail: `${engineOf(c.engine).title}${c.tag !== "none" ? ` · ${c.tag}` : ""}`,
  }));
  const picked = await pick(title, items);
  return picked ? findConnection(current(), picked) : undefined;
}
