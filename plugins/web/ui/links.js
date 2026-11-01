// Link files as a card: Internet shortcuts (.url), Safari's website locations (.webloc, XML or
// binary property list), freedesktop entries (.desktop) and Windows shortcuts (.lnk).
import { decodeText } from "./bytes.js";
import { readShellLink } from "./lnk.js";
import { readPlist } from "./plist.js";

/** @typedef {import("./formats.js").Card} Card */

/** The [group] → key → value of an INI-style file; keys keep their case, the first value wins. */
function ini(/** @type {string} */ text) {
  /** @type {Map<string, Map<string, string>>} */
  const groups = new Map();
  let group = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      group = groups.get(header[1]?.toLowerCase() ?? "") ?? new Map();
      groups.set(header[1]?.toLowerCase() ?? "", group);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!group.has(key)) group.set(key, line.slice(eq + 1).trim());
  }
  return groups;
}

/** The local path of a file: URL on this kind of machine (not a Windows drive), else undefined. */
export function localPath(/** @type {string | undefined} */ url) {
  if (!url || !/^file:/i.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.host && parsed.host !== "localhost") return undefined;
    const path = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:\//.test(path)) return undefined;
    return path.startsWith("/~/") ? path.slice(1) : path;
  } catch {
    return undefined;
  }
}

const nameOf = (/** @type {string} */ path) =>
  path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

/** @param {string} title @param {string | undefined} url @param {Array<[string, string]>} fields @returns {Card} */
const card = (title, url, fields) => {
  const path = localPath(url);
  return { title, ...(url ? { url } : {}), ...(path ? { path } : {}), fields };
};

/** `.url`: the [InternetShortcut] group's URL. */
export function readUrlFile(/** @type {Uint8Array} */ bytes, /** @type {string} */ path) {
  const shortcut = ini(decodeText(bytes, { sniff: false }).text).get("internetshortcut");
  const url = shortcut?.get("URL");
  if (!url) throw new Error("The shortcut names no URL.");
  /** @type {Array<[string, string]>} */
  const fields = [["URL", url]];
  const icon = shortcut?.get("IconFile");
  if (icon) fields.push(["Icon", icon]);
  return card(nameOf(path), url, fields);
}

/** `.webloc`: a property list whose URL key holds the address. */
export function readWebloc(/** @type {Uint8Array} */ bytes, /** @type {string} */ path) {
  const value = readPlist(bytes);
  const url = value && typeof value === "object" && "URL" in value ? value.URL : undefined;
  if (typeof url !== "string" || !url) throw new Error("The website location names no URL.");
  return card(nameOf(path), url, [["URL", url]]);
}

/** Unescape a .desktop value: \s \n \t \r \\. */
const desktopValue = (/** @type {string} */ value) =>
  value.replace(
    /\\([sntr\\])/g,
    (_, c) => ({ s: " ", n: "\n", t: "\t", r: "\r", "\\": "\\" })[c] ?? c,
  );

/** `.desktop`: Type=Link gives its URL; other types show their Name, Exec, Icon and Comment. */
export function readDesktopEntry(/** @type {Uint8Array} */ bytes, /** @type {string} */ path) {
  const entry = ini(decodeText(bytes, { sniff: false }).text).get("desktop entry");
  if (!entry) throw new Error("The file has no [Desktop Entry] group.");
  const get = (/** @type {string} */ key) => {
    const value = entry.get(key);
    return value === undefined ? undefined : desktopValue(value);
  };
  const type = get("Type") ?? "Application";
  const title = get("Name") ?? nameOf(path);
  /** @type {Array<[string, string]>} */
  const fields = [["Type", type]];
  const url = type === "Link" ? get("URL") : undefined;
  if (type === "Link" && !url) throw new Error("The link names no URL.");
  if (url) fields.push(["URL", url]);
  for (const key of ["Exec", "Path", "Icon", "Comment"]) {
    const value = get(key);
    if (value) fields.push([key, value]);
  }
  return card(title, url, fields);
}

/** `.lnk`: the target and the strings the shortcut carries; a relative path opens when it resolves. */
export function readLnk(/** @type {Uint8Array} */ bytes, /** @type {string} */ path) {
  const link = readShellLink(bytes);
  /** @type {Array<[string, string]>} */
  const fields = [];
  if (link.target) fields.push(["Target", link.target]);
  if (link.network) fields.push(["Network path", link.network]);
  if (link.arguments) fields.push(["Arguments", link.arguments]);
  if (link.workingDir) fields.push(["Working folder", link.workingDir]);
  if (link.description) fields.push(["Description", link.description]);
  if (link.icon) fields.push(["Icon location", link.icon]);
  if (link.relative) fields.push(["Relative path", link.relative]);
  if (fields.length === 0) throw new Error("The shortcut names no target.");
  /** @type {Card} */
  const result = { title: link.description || nameOf(path), fields };
  if (link.relative) {
    const folder = path.slice(0, path.lastIndexOf("/"));
    const parts = folder.split("/");
    for (const part of link.relative.split(/[\\/]/)) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    result.path = parts.join("/");
  }
  return result;
}
