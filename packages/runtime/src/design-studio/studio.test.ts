// @vitest-environment jsdom
import { compileDesignSystem, fillRecipe } from "@endue-ai/ui/design";
import { describe, expect, it, vi } from "vitest";
import type { CommandSpec, Commands } from "../commands";
import type { InstalledDesign } from "../design";
import type { RuntimeDesigns } from "../policies/design";
import type { StudioLang } from "../theme-studio/copy";
import { mountDesignStudio } from "./studio";

const soft: InstalledDesign = {
  id: "endue.design-soft",
  name: "Soft",
  description: "Pebbles.",
  designSystem: {
    author: "Team endue",
    tags: ["round"],
    components: { button: { shape: "full" } },
  },
};

function setup(lang: StudioLang = "en") {
  let active = "";
  let previewed: string | undefined;
  const listeners = new Set<() => void>();
  const drafts: unknown[] = [];
  const saved: unknown[] = [];
  const installed: InstalledDesign[] = [soft];
  const resolve = (id: string) => {
    const components = installed.find((d) => d.id === id)?.designSystem.components;
    return { id, recipe: fillRecipe(components), tokens: compileDesignSystem(components) };
  };
  const designs = {
    state: () => resolve(previewed ?? active),
    installed: () => installed,
    active: () => active,
    preview: (id: string | undefined) => {
      previewed = id;
    },
    previewing: () => previewed,
    apply: vi.fn((id: string) => {
      active = id;
      for (const listener of listeners) listener();
    }),
    resolve,
    previewDraft: (design: unknown) => drafts.push(design),
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    io: () => ({
      save: async (entry: InstalledDesign) => {
        saved.push(entry);
        installed.push(entry);
      },
      exportDesign: async (id: string) => `~/Downloads/${id}.desk-design`,
      importBundle: async () => "local.shared",
      importPath: async () => "local.shared",
      remove: async () => {},
    }),
    market: () => ({ list: async () => ({ designs: [], problems: [] }) }),
  } as unknown as RuntimeDesigns;
  const specs = new Map<string, CommandSpec>();
  const commands = {
    define: (id: string, spec: CommandSpec) => {
      specs.set(id, spec);
      return () => specs.delete(id);
    },
    run: vi.fn(async () => undefined),
  } as unknown as Commands;
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const studio = mountDesignStudio(host, {
    designs,
    commands,
    lang: () => lang,
    fallback: () => host,
    brain: () => undefined,
  });
  const key = (k: string) => host.querySelector<HTMLElement>(`[data-key="${k}"]`);
  return { studio, designs, host, specs, drafts, saved, key, commands };
}

describe("the design system studio", () => {
  it("opens from desk.design.studio on a gallery of the endue design system and every installed one", () => {
    const { specs, host } = setup();
    specs.get("desk.design.studio")?.run(undefined, {});
    const cards = [...host.querySelectorAll<HTMLElement>("[data-design]")];
    expect(cards.map((c) => c.dataset.design)).toEqual(["", "endue.design-soft"]);
    // Each card's specimen is drawn with its own component tokens.
    const specimen = cards[1]?.querySelector<HTMLElement>(".design-specimen");
    expect(specimen?.style.getPropertyValue("--desk-button-radius")).toBe(
      "var(--desk-radius-full)",
    );
    expect(cards[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("previews with the arrows, applies with Enter and closes", () => {
    const { studio, designs, host } = setup();
    studio.open();
    const grid = host.querySelector<HTMLElement>(".theme-grid");
    grid?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(designs.previewing()).toBe("endue.design-soft");
    grid?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(designs.apply).toHaveBeenCalledWith("endue.design-soft");
    expect(studio.isOpen()).toBe(false);
  });

  it("tunes a copy in the editor, previews each choice and saves it as the person's own", async () => {
    const { studio, designs, key, drafts, saved } = setup();
    studio.edit("endue.design-soft");
    const name = key("design-name") as HTMLInputElement;
    expect(name.value).toBe("Soft (copy)");
    const select = key("field.style") as HTMLSelectElement;
    select.value = "underline";
    select.dispatchEvent(new Event("change"));
    expect(drafts.at(-1)).toMatchObject({
      origin: { base: "endue.design-soft" },
      components: { button: { shape: "full" }, field: { style: "underline" } },
    });
    name.value = "Soft lines";
    key("design-save")?.click();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ id: "local.soft-lines", name: "Soft lines" });
    expect(designs.apply).toHaveBeenCalledWith("local.soft-lines");
  });

  it("names each of the tuner's choices by the token it sets and shows its options bare", () => {
    const { studio, host, key } = setup();
    studio.edit("");
    const selects = [...host.querySelectorAll<HTMLSelectElement>("select")];
    expect(selects).toHaveLength(48);
    const names = selects.map((s) => s.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(48);
    expect(key("button.shape")?.getAttribute("aria-label")).toBe("Button shape");
    expect(key("iconButton.shape")?.getAttribute("aria-label")).toBe("Icon button shape");
    const options = [...host.querySelectorAll("option")].map((o) => o.textContent);
    expect(options.filter((text) => text?.includes("·"))).toEqual([]);
    expect((key("button.shape") as HTMLSelectElement).selectedOptions[0]?.textContent).toBe("md");

    const ko = setup("ko");
    ko.studio.edit("");
    expect(ko.key("button.shape")?.getAttribute("aria-label")).toBe("버튼 모서리");
  });

  it("exports the selected design system and goes to the theme studio", async () => {
    const { studio, key, host, commands } = setup();
    studio.open();
    expect((key("design-export") as HTMLButtonElement).disabled).toBe(true);
    const cards = host.querySelectorAll<HTMLElement>("[data-design]");
    cards[1]?.click();
    (key("design-export") as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(host.textContent).toContain("~/Downloads/endue.design-soft.desk-design"),
    );
    key("design-themes")?.click();
    expect(commands.run).toHaveBeenCalledWith("desk.theme.studio");
  });
});
