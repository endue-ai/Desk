/**
 * The browser stub's shell.open, as the core answers it (specs/bridge/v0/README.md): only http,
 * https and mailto URLs without control characters, read as the URL parser reads them, and paths
 * only revealed. Nothing reaches the system: every call that passes is recorded (`StubOpened`) and
 * handed to `open`, so plugin tests and runtime e2e can see it. Without a grant covering the scope
 * the stub asks, as the core does.
 */
import { StubError, type StubHandlers } from "./adapters";
import type { CallerId, ShellOpenPermission, ShellScheme } from "./generated";
import { pathMatch } from "./stub-fs";

/** One call the stub let through: the URL as parsed, or the path to reveal. */
export interface StubOpened {
  caller: CallerId;
  target: string;
  reveal: boolean;
}

export type ShellServed = "shell.open";

interface ShellDeps {
  /** Throws permission_denied unless a grant covers `scope` (and `fits`); spends a once grant. */
  check(caller: string | undefined, scope: ShellOpenPermission, fits?: boolean): void;
  /** Whether the caller holds a grant covering `scope`; the runtime holds every one. */
  may(caller: string | undefined, scope: ShellOpenPermission): boolean;
  /** perm.request: asks the person for the scope unless a grant covers it. */
  request: NonNullable<StubHandlers["perm.request"]>;
  opened: StubOpened[];
  open?: (opened: StubOpened) => void;
  me(caller: string | undefined): string;
}

const SCHEMES: Record<string, ShellScheme> = {
  "http:": "http",
  "https:": "https",
  "mailto:": "mailto",
};
const ROOTED = /^(\/|~(\/|$)|[A-Za-z]:\/|\$\{(plugin|workspace|home)\}(\/|$))[^\\]*$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it finds
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const invalid = (message: string) => new StubError("invalid_params", message);

/** A link the core would hand the system, as the URL parser reads it; invalid_params otherwise. */
export function shellLink(target: string): { scheme: ShellScheme; url: string } {
  if (CONTROL.test(target)) throw invalid("the link holds a control character");
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw invalid(`${JSON.stringify(target)} is not an absolute URL`);
  }
  const scheme = SCHEMES[url.protocol];
  if (!scheme)
    throw invalid(`${url.protocol} links are never opened; only http, https and mailto are`);
  return { scheme, url: url.href };
}

/** `.` and `..` collapsed, as desk-core normalizes a path before matching it; null past the root. */
function normalize(path: string): string | null {
  const [root = "", ...rest] = path.split("/");
  const kept: string[] = [];
  for (const segment of rest) {
    if (segment === ".." && kept.pop() === undefined) return null;
    if (segment !== ".." && segment !== "." && segment !== "") kept.push(segment);
  }
  return [root, ...kept].join("/") || "/";
}

export function stubShell(deps: ShellDeps): Required<Pick<StubHandlers, ShellServed>> {
  return {
    "shell.open": async ({ target, reveal = false, scope }, caller) => {
      let shown = target;
      let fits: boolean;
      let reason: string;
      if (reveal) {
        const path = ROOTED.test(target) ? normalize(target) : null;
        if (path === null) throw invalid(`not a rooted path: ${target}`);
        fits = scope.paths?.some((pattern) => pathMatch(pattern, path)) ?? false;
        reason = `To show ${target} in the file manager`;
      } else {
        const link = shellLink(target);
        shown = link.url;
        fits = scope.schemes?.includes(link.scheme) ?? false;
        reason = `To open ${link.url}`;
      }
      if (fits && !deps.may(caller, scope)) {
        const { granted } = await deps.request({ permission: scope, reason }, caller);
        if (!granted)
          throw new StubError("permission_denied", "the person did not allow it", scope);
      }
      deps.check(caller, scope, fits);
      const opened = { caller: deps.me(caller), target: shown, reveal };
      deps.opened.push(opened);
      deps.open?.(structuredClone(opened));
      return { opened: true };
    },
  };
}
