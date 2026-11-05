// @vitest-environment jsdom
import type { BrainTurnData } from "@endue-ai/bridge";
import { fillRecipe } from "@endue-ai/ui/design";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeDesigns } from "../policies/design";
import type { ThemeBrain } from "../policies/theme";
import { createDesignDescribe } from "./describe";
import { cleanDesignProposal, designPrompt, PROPOSE_DESIGN } from "./prompt";

describe("Describe's prompt and answer", () => {
  it("sends the rules, every option, what is in force and the sentence last, nothing else", () => {
    const prompt = designPrompt("square and caps", fillRecipe({ button: { shape: "full" } }));
    expect(prompt).toContain("A design system decides what each component of the desk is made of");
    expect(prompt).toContain("field: style (outline | filled | underline)");
    expect(prompt).toContain('{"button":{"shape":"full"}}');
    expect(prompt.split("\n").at(-1)).toBe("The person says: square and caps");
    expect(PROPOSE_DESIGN.name).toBe("propose_design_system");
  });

  it("cleans an answer to known options and needs a name", () => {
    expect(
      cleanDesignProposal({
        name: " Square ",
        description: "Caps.",
        components: { button: { shape: "none", glow: "yes" }, carousel: {} },
      }),
    ).toEqual({ name: "Square", description: "Caps.", components: { button: { shape: "none" } } });
    expect(cleanDesignProposal({ description: "no name" })).toBeUndefined();
    expect(cleanDesignProposal(undefined)).toBeUndefined();
  });
});

describe("Describe", () => {
  it("previews the brain's design system and saves it as the person's own on Apply", async () => {
    let hear: ((turn: BrainTurnData) => void) | undefined;
    const brain = {
      ask: vi.fn(async (_prompt: string, _tool: unknown, h: (turn: BrainTurnData) => void) => {
        hear = h;
        return () => {};
      }),
      status: async () => ({ mode: "local", model: "echo" }),
    } as unknown as ThemeBrain;
    const drafts: unknown[] = [];
    const saved: unknown[] = [];
    const designs = {
      active: () => "",
      installed: () => [],
      resolve: () => ({ id: "", recipe: fillRecipe({}), tokens: {} }),
      previewDraft: (d: unknown) => drafts.push(d),
      apply: vi.fn(),
      io: () => ({ save: async (entry: unknown) => saved.push(entry) }),
    } as unknown as RuntimeDesigns;
    const back = vi.fn();
    const view = createDesignDescribe({
      designs,
      brain: () => brain,
      lang: () => "en",
      back,
      tune: vi.fn(),
      toEris: vi.fn(),
    });
    document.body.replaceChildren(view.element);
    view.start({ text: "square with caps", run: true });
    await vi.waitFor(() => expect(brain.ask).toHaveBeenCalled());
    hear?.({
      turnId: "t1",
      kind: "completed",
      structured: {
        name: "Square caps",
        description: "Caps.",
        components: { button: { case: "uppercase" } },
      },
    });
    expect(drafts.at(-1)).toEqual({
      origin: { prompt: "square with caps" },
      components: { button: { case: "uppercase" } },
    });
    document.querySelector<HTMLElement>('[data-key="design-apply"]')?.click();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ id: "local.square-caps", name: "Square caps" });
    expect(designs.apply).toHaveBeenCalledWith("local.square-caps");
    expect(back).toHaveBeenCalledWith("local.square-caps");
  });
});
