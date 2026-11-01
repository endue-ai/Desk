/** How the browser stub judges a grant against a scope, as desk-core's `covers` does (perm.rs). */
import type { Permission } from "./generated";

/** `*` matches any run of characters, dots included (or what `any` allows). */
export function starMatch(pattern: string, text: string, any = ".*"): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(any);
  return new RegExp(`^${source}$`).test(text);
}

/** `owner/key` patterns: `*` stays within its part. */
export const keyMatch = (pattern: string, text: string) => starMatch(pattern, text, "[^/]*");
/** Paths, hosts and programs: equal, under a trailing `*`, or under a leading `*.`. */
const within = (grant: string, asked: string) =>
  grant === asked ||
  (grant.endsWith("*") && asked.startsWith(grant.replace(/\*+$/, ""))) ||
  (grant.startsWith("*.") && asked.endsWith(grant.slice(1)));

const at = (permission: Permission, field: string) =>
  (permission as unknown as Record<string, unknown>)[field];

type Match = (pattern: string, text: string) => boolean;
/** The list each scoped permission carries, and how a granted pattern covers an asked one. */
const LISTS: Partial<Record<Permission["permission"], [string, Match]>> = {
  "cmd:invoke": ["ids", (p, t) => starMatch(p, t)],
  "settings:read": ["keys", keyMatch],
  "events:subscribe": ["names", (p, t) => p === t],
  "fs:read": ["paths", within],
  "fs:write": ["paths", within],
  "net:fetch": ["hosts", within],
  "proc:spawn": ["commands", within],
};

/** A granted list covers an asked one; an absent list means all, which only an absent grant covers. */
function narrows(granted: string[] | undefined, asked: string[] | undefined, match: Match) {
  if (granted === undefined) return true;
  return asked?.every((a) => granted.some((g) => match(g, a))) ?? false;
}

/** Every asked entry matched by a granted one; an absent list asks nothing and grants nothing. */
const each = (granted: string[] = [], asked: string[] = [], match: Match) =>
  asked.every((a) => granted.some((g) => match(g, a)));

/** Whether `grant` covers everything `scope` asks for, as desk-core's `covers` judges it. */
export function covers(grant: Permission, scope: Permission): boolean {
  if (grant.permission === "shell:open" && scope.permission === "shell:open")
    return (
      each(grant.schemes, scope.schemes, (g, a) => g === a) &&
      each(grant.paths, scope.paths, within)
    );
  if (grant.permission === "data:read" && scope.permission === "data:read")
    return (
      narrows(grant.kinds, scope.kinds, (g, a) => g === a) &&
      narrows(grant.sources, scope.sources, (g, a) => starMatch(g, a))
    );
  const [field, match] = LISTS[scope.permission] ?? ["", () => true];
  const list = (p: Permission) => (at(p, field) ?? []) as string[];
  const flag = (name: string) => at(scope, name) !== true || at(grant, name) === true;
  const all = list(scope).every((text) => list(grant).some((pattern) => match(pattern, text)));
  return grant.permission === scope.permission && all && flag("pty") && flag("wakeWord");
}
