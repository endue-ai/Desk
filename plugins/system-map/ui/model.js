// A message reference remains distinct from a device name, even if the name matches a catalog key.
export const msg = (message) => ({ message });
export const idFor = (...parts) => JSON.stringify(parts);

/**
 * @typedef {string | {message: string}} Label
 * @typedef {{id: string, label: Label, fields: Record<string, unknown>, children: MapNode[]}} MapNode
 */
/** @param {string} id @param {Label} label @param {Record<string, unknown>} fields @param {MapNode[]} children @returns {MapNode} */
export function node(id, label, fields = {}, children = []) {
  return { id, label, fields, children };
}

export function group(id, children, fields = {}) {
  const status = children.length ? {} : { status: msg("status.empty") };
  return node(id, msg(`group.${id}`), { ...status, ...fields }, children);
}

export function source(id, text, parse) {
  try {
    if (typeof text !== "string") throw Error();
    return group(id, parse(text));
  } catch {
    return group(id, [], { status: msg("status.unavailable") });
  }
}

export function profile(text, type) {
  const records = JSON.parse(text)[type];
  if (!Array.isArray(records)) throw Error();
  return records;
}
