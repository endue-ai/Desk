// @vitest-environment jsdom
import type { ThemePackage } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeThemes } from "../policies/theme";
import type { InstalledTheme, ThemeState } from "../theme";
import { createEditor, type ThemeIo } from "./editor";

const amber: InstalledTheme = {
  id: "endue.theme-amber",
  name: "Amber",
  description: "Amber phosphor.",
  url: (path) => `/endue.theme-amber/${path}`,
  theme: {
    type: { fonts: [{ family: "Plex Mono", src: "fonts/plex.woff2" }] },
    dark: { colors: { background: "#120c04", primary: "#ffb000" } },
  },
};

function setup(io?: ThemeIo) {
  const drafts: Array<{
    theme: ThemePackage | undefined;
    files?: Record<string, string>;
    scheme?: string;
  }> = [];
  const state = {
    tokens: { background: "#120c04", primary: "#ffb000", card: "#1a1208", surfaceOpacity: "1" },
    fixes: [{ token: "textMuted", from: "#555555", to: "#8a8a8a", against: "hover", ratio: 4.52 }],
  } as unknown as ThemeState;
  const themes = {
    state: () => state,
    installed: () => [amber],
    previewDraft: (
      theme: ThemePackage | undefined,
      files?: Record<string, string>,
      scheme?: string,
    ) => drafts.push({ theme: theme && structuredClone(theme), files, scheme }),
    apply: vi.fn(),
  } as unknown as RuntimeThemes;
  const back = vi.fn();
  const editor = createEditor({ themes, lang: () => "en", io: () => io, back });
  document.body.replaceChildren(editor.element);
  return { editor, drafts, themes, back };
}

const input = (key: string) => document.querySelector<HTMLInputElement>(`[data-key="${key}"]`);

describe("the theme editor", () => {
  it("starts from a copy of a theme and previews it in the scheme in force", () => {
    const { editor, drafts } = setup();
    editor.start("endue.theme-amber", "dark");
    expect(input("theme-name")?.value).toBe("Amber 2");
    expect(drafts.at(-1)?.scheme).toBe("dark");
    expect(drafts.at(-1)?.theme?.dark?.colors?.primary).toBe("#ffb000");
    // The font it already has comes from the theme's own folder.
    expect(drafts.at(-1)?.files).toEqual({
      "fonts/plex.woff2": "/endue.theme-amber/fonts/plex.woff2",
    });
  });

  it("writes a changed colour with its companions and previews it at once", () => {
    const { editor, drafts } = setup();
    editor.start("endue.theme-amber", "dark");
    const picker = input("color-primary");
    if (!picker) throw new Error("no primary field");
    picker.value = "#33ccff";
    picker.dispatchEvent(new Event("input"));
    expect(drafts.at(-1)?.theme?.dark?.colors).toMatchObject({
      primary: "#33ccff",
      ring: "#33ccff",
    });
  });

  it("lists the gate's fixes beside the palette", () => {
    const { editor } = setup();
    editor.start(undefined, "light");
    expect(document.querySelector(".theme-fixes")?.textContent).toContain(
      "textMuted #555555 → #8a8a8a",
    );
  });

  it("switches scheme with its tabs", () => {
    const { editor, drafts } = setup();
    editor.start("endue.theme-amber", "dark");
    document.querySelector<HTMLButtonElement>('[data-key="scheme-light"]')?.click();
    expect(drafts.at(-1)?.scheme).toBe("light");
    expect(document.querySelector('[data-key="scheme-light"]')?.getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("saves as local.<name> with its new files and the source to copy the rest from, then applies it", async () => {
    const save = vi.fn(async () => {});
    const io: ThemeIo = { save, exportTheme: vi.fn(), importBundle: vi.fn(), remove: vi.fn() };
    const { editor, themes, back } = setup(io);
    editor.start("endue.theme-amber", "dark");
    const name = input("theme-name");
    if (!name) throw new Error("no name field");
    name.value = "My Amber";
    name.dispatchEvent(new Event("change"));
    document.querySelector<HTMLButtonElement>('[data-key="editor-save"]')?.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    const [entry, files, copyFrom] = save.mock.calls[0] as unknown as [
      { id: string; name: string },
      unknown[],
      string,
    ];
    expect(entry).toMatchObject({ id: "local.my-amber", name: "My Amber" });
    expect(files).toEqual([]);
    expect(copyFrom).toBe("endue.theme-amber");
    await vi.waitFor(() => expect(themes.apply).toHaveBeenCalledWith("local.my-amber"));
    expect(back).toHaveBeenCalledWith("local.my-amber");
  });

  it("cannot save until the core has theme.*", () => {
    const { editor } = setup();
    editor.start(undefined, "dark");
    expect(document.querySelector<HTMLButtonElement>('[data-key="editor-save"]')?.disabled).toBe(
      true,
    );
  });

  it("asks before removing a saved theme, lets the user cancel, and removes only on confirmation", async () => {
    const remove = vi.fn(async () => {});
    const io: ThemeIo = { save: vi.fn(), exportTheme: vi.fn(), importBundle: vi.fn(), remove };
    const { editor, themes, back } = setup(io);
    editor.start("local.my-theme", "dark");
    const button = (label: string) => {
      const found = [
        ...editor.element.querySelectorAll<HTMLButtonElement>(".theme-editor-actions button"),
      ].find((el) => el.textContent === label);
      if (!found) throw new Error(`no ${label} button`);
      return found;
    };

    editor.element.querySelector<HTMLButtonElement>('[data-key="editor-remove"]')?.click();
    expect(remove).not.toHaveBeenCalled();
    expect(themes.apply).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(editor.element.querySelector(".theme-editor-actions")?.textContent).toContain(
      "Remove this theme? It cannot be undone.",
    );
    button("Cancel").click();
    expect(editor.element.querySelector(".theme-editor-actions")?.textContent).not.toContain(
      "Remove this theme? It cannot be undone.",
    );
    expect(remove).not.toHaveBeenCalled();

    editor.element.querySelector<HTMLButtonElement>('[data-key="editor-remove"]')?.click();
    button("Remove").click();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(remove).toHaveBeenCalledWith("local.my-theme");
    expect(themes.apply).toHaveBeenCalledWith("");
    expect(back).toHaveBeenCalledWith("");
  });

  it("cancels the remove confirmation on Escape without closing the studio", () => {
    const io: ThemeIo = {
      save: vi.fn(),
      exportTheme: vi.fn(),
      importBundle: vi.fn(),
      remove: vi.fn(),
    };
    const { editor } = setup(io);
    const parentKeydown = vi.fn();
    document.body.addEventListener("keydown", parentKeydown);
    editor.start("local.my-theme", "dark");
    editor.element.querySelector<HTMLButtonElement>('[data-key="editor-remove"]')?.click();
    expect(editor.element.querySelector(".theme-editor-actions")?.textContent).toContain(
      "Remove this theme? It cannot be undone.",
    );
    editor.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(editor.element.querySelector(".theme-editor-actions")?.textContent).not.toContain(
      "Remove this theme? It cannot be undone.",
    );
    expect(editor.element.querySelector('[data-key="editor-remove"]')).not.toBeNull();
    expect(io.remove).not.toHaveBeenCalled();
    expect(parentKeydown).not.toHaveBeenCalled();
    document.body.removeEventListener("keydown", parentKeydown);
  });
});
