/**
 * Which plugin opens a file, and under which name (desk.files, #162 findings 10 and 12). The rules
 * (`contributes.files`, auto-mode-alist) name the opener; a file no rule names opens in the desk's
 * fallbacks, as Emacs's fundamental-mode: a name without an extension (README, Makefile, .zshrc) as
 * text first, then `desk.files.fallback`, whose view reads the format from the first bytes and shows
 * the file's details when it cannot show the file. One file is one buffer: its path is made one
 * spelling before the buffer is named.
 */
import { baseName } from "../buffers";
import { globMatch, type PolicySet } from "../policy";

/**
 * The opener for `path`: the first rule whose pattern matches the file name (or the whole path) as
 * written; when none does, the first that matches it in any case, as Emacs's auto-mode-case-fold
 * (`IMG_0001.JPG` opens with a `*.jpg` rule, while `*.Z` still wins for `x.Z` over an earlier `*.z`).
 */
export function opener(rules: PolicySet["files"], path: string): string | undefined {
  const name = baseName(path);
  const subject = (pattern: string) => (pattern.includes("/") ? path : name);
  const exact = rules.find((rule) => globMatch(rule.pattern, subject(rule.pattern)));
  const folded = (pattern: string) =>
    globMatch(pattern.toLowerCase(), subject(pattern).toLowerCase());
  return (exact ?? rules.find((rule) => folded(rule.pattern)))?.plugin;
}

/** Whether a file name has an extension: a dot after its first character (`.zshrc` has none). */
export const hasExtension = (name: string) => name.lastIndexOf(".") > 0;

/**
 * The plugins that may open `path`, to try in turn: the one its rule names; for a file no rule
 * names, the text opener (the plugin `.txt` files open with) when the name has no extension, then
 * `fallback`. Only installed plugins; none when nothing may open it.
 */
export function openers(
  rules: PolicySet["files"],
  path: string,
  fallback: string,
  installed: (plugin: string) => boolean,
): string[] {
  const ruled = opener(rules, path);
  if (ruled) return [ruled];
  const text = hasExtension(baseName(path)) ? undefined : opener(rules, `${path}.txt`);
  const tried = [text, fallback].filter((p): p is string => !!p && installed(p));
  return [...new Set(tried)];
}

/**
 * `path` in one spelling, as desk-core normalizes a bridge path: `${home}` as `~`, empty and `.`
 * segments dropped, `..` taken back, no trailing slash. A path with no root, or whose `..` would
 * leave it, stays as it was given.
 */
export function onePath(path: string): string {
  const given = path.replace(/^\$\{home\}(?=\/|$)/, "~");
  const root = /^(\/|~(?=\/|$)|[A-Za-z]:(?=\/|$)|\$\{[a-z]+\}(?=\/|$))/.exec(given)?.[1];
  if (root === undefined) return path;
  const segments: string[] = [];
  for (const segment of given.slice(root.length).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") segments.push(segment);
    else if (segments.pop() === undefined) return path;
  }
  if (segments.length === 0) return root;
  return `${root === "/" ? "" : root}/${segments.join("/")}`;
}
