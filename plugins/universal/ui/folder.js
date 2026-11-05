// desk.universal.folder { path }: a folder as universal data (ADR 0087), so "this folder as a
// timeline" has a source. One entry per file and folder from fs.list: its name as the title, its
// modified time as start, folder or its extension as group, its size as detail; newest first. Pure.

/**
 * @typedef {import("../../../packages/bridge/src/index").UniversalData} UniversalData
 * @typedef {import("../../../packages/bridge/src/index").DirEntry} DirEntry
 */

/** @param {number} bytes */
export function sizeOf(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** @param {DirEntry} entry */
function groupOf(entry) {
  if (entry.kind === "dir") return "folder";
  const dot = entry.name.lastIndexOf(".");
  return dot > 0 && dot < entry.name.length - 1 ? entry.name.slice(dot + 1).toLowerCase() : "file";
}

/**
 * The universal data of a folder's entries, hidden ones left out.
 * @param {string} path
 * @param {DirEntry[]} entries
 * @returns {UniversalData}
 */
export function folderData(path, entries) {
  const folder = path.replace(/\/+$/, "") || "/";
  const name = folder.split("/").filter(Boolean).at(-1) ?? folder;
  const shown = entries
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => ({
      id: `${folder}/${entry.name}`,
      title: entry.name,
      ...(entry.modifiedAt ? { start: entry.modifiedAt } : {}),
      group: groupOf(entry),
      ...(entry.size !== undefined && entry.kind !== "dir" ? { detail: sizeOf(entry.size) } : {}),
      path: `${folder}/${entry.name}`,
      kind: entry.kind,
    }))
    .sort((a, b) => String(b.start ?? "").localeCompare(String(a.start ?? "")));
  return { universal: "v0", title: name, entries: shown };
}
