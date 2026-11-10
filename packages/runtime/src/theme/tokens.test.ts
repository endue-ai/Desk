import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BridgeClient } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import desk from "../../../../plugins/theme/plugin.json";
import amber from "../../../../plugins/theme-amber/plugin.json";
import type { PolicySet } from "../policy";
import { type InstalledTheme, resolveTheme, type ThemeState } from "../theme";
import { tokenPublisher, tokenTable } from "./tokens";

const policy = desk.contributes.themes.map((theme) => ({
  ...theme,
  owner: desk.id,
})) as PolicySet["themes"];
const installed: InstalledTheme[] = [
  {
    id: amber.id,
    name: amber.name,
    theme: amber.theme as InstalledTheme["theme"],
    url: (path) => `/${amber.id}/${path}`,
  },
];
const media = { dark: true, highContrast: false, reducedMotion: false };
const look = (scheme: "light" | "dark", active = "") =>
  resolveTheme(policy, { scheme, contrast: "normal", motion: "full", active }, media, installed);

/** The tables the compositor's tests and demo read: bridge vectors, so both contracts judge them. */
const VECTORS = join(import.meta.dirname, "../../../../specs/bridge/v0/vectors/valid");
const TABLES = [
  ["theme-tokens-request.json", "the endue theme, dark: the desk's default look", look("dark")],
  ["theme-tokens-request-light.json", "the endue theme, light", look("light")],
  [
    "theme-tokens-request-amber.json",
    "endue.theme-amber, dark: square corners, no shadows, a monospace stack",
    look("dark", amber.id),
  ],
] as const;

describe("theme.tokens", () => {
  it("carries the resolved look: scheme, contrast, motion, the theme and every token by name", () => {
    const state = look("dark", amber.id);
    const table = tokenTable(state);
    expect(table).toMatchObject({
      scheme: "dark",
      contrast: "normal",
      reducedMotion: false,
      theme: "endue.theme-amber",
      design: "",
    });
    expect(table.tokens.radiusLg).toBe(state.tokens.radiusLg);
    // A design system's component tokens travel as references; the compositor follows them.
    expect(table.tokens.toastRadius).toBe("var(--desk-radius-lg)");
    expect(Object.keys(table.tokens)).toEqual(Object.keys(table.tokens).sort());
  });

  it("leaves out tokens the spec cannot carry", () => {
    const state = {
      ...look("dark"),
      tokens: { text: "#fff", "bad-name": "#000", long: "x".repeat(2000) },
    };
    expect(tokenTable(state as ThemeState).tokens).toEqual({ text: "#fff" });
  });

  it("sends each new table once, and stops when the core does not serve it", async () => {
    const sent: unknown[] = [];
    let answer: "ok" | "unsupported" | "denied" = "ok";
    const bridge = {
      call: async (method: string, params: unknown) => {
        sent.push({ method, params });
        if (answer !== "ok")
          throw Object.assign(new Error(answer), {
            code: answer === "denied" ? "permission_denied" : "unsupported",
          });
        return { revision: sent.length, tokens: 1 };
      },
    } as unknown as Pick<BridgeClient, "call">;
    const publisher = tokenPublisher(bridge);
    publisher.send(look("dark"));
    publisher.send(look("dark"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: "theme.tokens",
      params: { scheme: "dark", scope: { permission: "theme:manage" } },
    });
    answer = "denied";
    publisher.send(look("light"));
    await Promise.resolve();
    await Promise.resolve();
    // A refusal is tried again with the same table; an unsupported core is never asked again.
    answer = "unsupported";
    publisher.send(look("light"));
    await Promise.resolve();
    await Promise.resolve();
    publisher.send(look("dark"));
    expect(sent).toHaveLength(3);
  });

  it.each(TABLES)("%s is the table the runtime sends for %s", (file, description, state) => {
    const vector = {
      target: "BridgeRequest",
      description: `theme.tokens: ${description}`,
      instance: {
        id: 1,
        method: "theme.tokens",
        params: { ...tokenTable(state), scope: { permission: "theme:manage" } },
      },
    };
    const path = join(VECTORS, file);
    if (process.env.UPDATE_VECTORS === "1")
      writeFileSync(path, `${JSON.stringify(vector, null, 2)}\n`);
    // A token change in @endue-ai/ui or a theme plugin shows here: UPDATE_VECTORS=1 rewrites them.
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(vector);
  });
});
