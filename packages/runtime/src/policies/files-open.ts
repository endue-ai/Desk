/**
 * Which plugin opens a file, and under which name (desk.files, #162 findings 10 and 12). The rules
 * (`contributes.files`, auto-mode-alist) name the opener; a file no rule names opens in the desk's
 * fallbacks, as Emacs's fundamental-mode: a name without an extension (README, Makefile, .zshrc) as
 * text first, then `desk.files.fallback`, whose view reads the format from the first bytes and shows
 * the file's details when it cannot show the file. One file is one buffer: its path is made one
 * spelling before the buffer is named.
 */
import { baseName } from "../buffers";
import type { AgentSpec, CommandCaller } from "../commands";
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

/**
 * Whether an open is the person's own choice, which answers the opener's ask for the file: the desk's
 * own (keys, the palette, the file picker, a restored session), or a plugin's on the person's click
 * (Explorer) with the opener the desk's rules name. Never an agent's, and never a plugin naming the
 * plugin to open with, which could name itself.
 */
export function personChose(from: CommandCaller, named: string | undefined): boolean {
  const { caller } = from;
  if (caller === undefined) return true;
  return !caller.startsWith("agent:") && named === undefined;
}

/** The read scope an opener carries for a file: its whole folder, as the openers ask. */
export const folderRead = (path: string) => ({
  permission: "fs:read" as const,
  paths: [`${path.slice(0, path.lastIndexOf("/"))}/**`],
});

/** What agents read of desk.files.open (ADR 0088). */
export const OPEN_FOR_AGENTS: AgentSpec = {
  description:
    "Open a file on the desk for the person, in the plugin that opens its kind (plugin names another); answers its buffer id.",
  args: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1, description: "A bridge path, such as ~/Notes/a.md" },
      plugin: { type: "string", minLength: 1 },
    },
  },
};
