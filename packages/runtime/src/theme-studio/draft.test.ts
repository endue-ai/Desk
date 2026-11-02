import type { ThemePackage } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { companions, draftFrom, localId, setColor, slug } from "./draft";

describe("the editor's draft", () => {
  it("is a deep copy of the theme, without its origin", () => {
    const theme: ThemePackage = {
      origin: { prompt: "warm paper" },
      dark: { colors: { background: "#101010" } },
    };
    const draft = draftFrom(theme);
    expect(draft.origin).toBeUndefined();
    if (draft.dark?.colors) draft.dark.colors.background = "#202020";
    expect(theme.dark?.colors?.background).toBe("#101010");
    expect(draftFrom()).toEqual({ light: {}, dark: {} });
  });

  it("brings a base colour's companions along", () => {
    const draft = draftFrom();
    setColor(draft, "dark", "primary", "#ff8a4c");
    expect(draft.dark?.colors).toMatchObject({
      primary: "#ff8a4c",
      primaryText: "#ff8a4c",
      ring: "#ff8a4c",
      accent: "#ff8a4c",
      primarySoft: "rgba(255, 138, 76, 0.12)",
      primaryBorder: "rgba(255, 138, 76, 0.34)",
    });
    expect(companions("danger", "#c00000", "light")).toEqual({
      dangerText: "#c00000",
      dangerSoft: "rgba(192, 0, 0, 0.16)",
      dangerBorder: "rgba(192, 0, 0, 0.4)",
    });
    expect(companions("background", "#000", "dark")).toEqual({});
    expect(companions("primary", "not a colour", "dark")).toEqual({});
  });

  it("is saved under local.<slug>, numbered when the id is taken, keeping its own", () => {
    expect(slug("Paper & Ink!")).toBe("paper-ink");
    expect(slug("따뜻한 종이")).toBe("theme");
    expect(slug("2077 Night")).toBe("theme-2077-night");
    expect(localId("Paper", [])).toBe("local.paper");
    expect(localId("Paper", ["local.paper", "local.paper-2"])).toBe("local.paper-3");
    expect(localId("Paper", ["local.paper"], "local.paper")).toBe("local.paper");
  });
});
