/**
 * theme.tokens (ADR 0146): the look in force as the flat token table the compositor draws the desk's
 * chrome from. The runtime resolves themes while it still does (ADR 0056), so it hands the core the
 * table each time the look changes: the theme's six layers with the design system's component tokens
 * over them, as the shell applies them. Tokens flow one way, theme → table → compositor.
 */
import type { BridgeClient, ThemeTokensParams } from "@endue-ai/bridge";
import type { ThemeState } from "../theme";

/** What theme.tokens carries besides its scope. */
export type TokenTable = Omit<ThemeTokensParams, "scope">;

/** The names, lengths and count the spec allows (ThemeTokenMap). */
const NAME = /^[a-z][A-Za-z0-9]*$/;
const NAME_MAX = 64;
const VALUE_MAX = 1024;
const TOKENS_MAX = 1024;

/** The table of a resolved look, its tokens in name order; tokens the spec cannot carry are left out. */
export function tokenTable(state: ThemeState): TokenTable {
  const tokens = Object.entries(state.tokens)
    .filter(
      ([name, value]) => NAME.test(name) && name.length <= NAME_MAX && value.length <= VALUE_MAX,
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, TOKENS_MAX);
  return {
    scheme: state.scheme,
    contrast: state.contrast,
    reducedMotion: state.reducedMotion,
    theme: state.active ?? "",
    design: state.design ?? "",
    tokens: Object.fromEntries(tokens),
  };
}

/** Sends the table to the core; the same table again is not sent. */
export interface TokenPublisher {
  send(state: ThemeState): void;
}

/**
 * A publisher over `bridge`. A core that does not serve theme.tokens (an older one, a stub without
 * it) is asked once; any other failure is retried with the next change.
 */
export function tokenPublisher(bridge: Pick<BridgeClient, "call">): TokenPublisher {
  let last = "";
  let unsupported = false;
  return {
    send(state) {
      if (unsupported) return;
      const table = tokenTable(state);
      const key = JSON.stringify(table);
      if (key === last) return;
      last = key;
      bridge
        .call("theme.tokens", { ...table, scope: { permission: "theme:manage" } })
        .catch((error: unknown) => {
          if ((error as { code?: unknown } | undefined)?.code === "unsupported") unsupported = true;
          else if (last === key) last = "";
        });
    },
  };
}
