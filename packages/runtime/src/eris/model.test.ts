import { describe, expect, it } from "vitest";
import type { BrainName, BrainStatus } from "../bridge/types";
import type { ShellCtx } from "../shell/context";
import { modelChoiceOf, modelName, useModel } from "./model";

describe("modelChoiceOf", () => {
  it("reads brains, Claude Code's aliases and local models as a person names them", () => {
    expect(modelChoiceOf("endue")).toEqual({ brain: "endue" });
    expect(modelChoiceOf("Claude Code")).toEqual({ brain: "claude" });
    expect(modelChoiceOf("Sonnet")).toEqual({ brain: "claude", model: "sonnet" });
    expect(modelChoiceOf("claude-opus-4-1")).toEqual({ brain: "claude", model: "claude-opus-4-1" });
    expect(modelChoiceOf("local:qwen2.5")).toEqual({ brain: "local", model: "qwen2.5" });
    expect(modelChoiceOf("llama3.2")).toEqual({ brain: "local", model: "llama3.2" });
    expect(modelChoiceOf("local")).toEqual({ brain: "local" });
    expect(modelChoiceOf("  ")).toBeUndefined();
  });

  it("takes the brain an agent names, with its model", () => {
    expect(modelChoiceOf("haiku", "claude")).toEqual({ brain: "claude", model: "haiku" });
    expect(modelChoiceOf("default", "claude")).toEqual({ brain: "claude", model: "" });
    expect(modelChoiceOf("", "local")).toEqual({ brain: "local" });
    expect(modelChoiceOf("whatever", "endue")).toEqual({ brain: "endue" });
  });
});

/** A ctx whose bridge records what was set, as the desk's settings would. */
function fakeCtx(withModels = true) {
  const set: Array<[string, string]> = [];
  let brain: BrainName = "endue";
  const status = async (): Promise<BrainStatus> => ({ mode: "cloud", credits: 0, brain });
  const patches: unknown[] = [];
  const ctx = {
    bridge: {
      brain: {
        status,
        use: async (b: BrainName) => {
          set.push(["brain.use", b]);
          brain = b;
          return status();
        },
        ...(withModels
          ? {
              models: {
                get: async () => ({ local: "", claude: "" }),
                set: async (b: "local" | "claude", model: string) => {
                  set.push([b, model]);
                },
              },
            }
          : {}),
      },
    },
    store: { set: (patch: unknown) => patches.push(patch) },
  } as unknown as ShellCtx;
  return { ctx, set, patches };
}

describe("useModel", () => {
  it("sets the model first, then the brain, and shows the new status", async () => {
    const { ctx, set, patches } = fakeCtx();
    await useModel(ctx, { brain: "claude", model: "sonnet" });
    expect(set).toEqual([
      ["claude", "sonnet"],
      ["brain.use", "claude"],
    ]);
    expect(patches).toEqual([{ brain: { mode: "cloud", credits: 0, brain: "claude" } }]);
  });

  it("refuses a local brain without a model, and a host that cannot set one", async () => {
    await expect(useModel(fakeCtx().ctx, { brain: "local", model: " " })).rejects.toThrow(
      "Name the local model",
    );
    await expect(useModel(fakeCtx(false).ctx, { brain: "claude", model: "opus" })).rejects.toThrow(
      "cannot change the model",
    );
  });

  it("names the model in force", () => {
    expect(modelName("claude", { local: "", claude: "sonnet" })).toBe("Claude Code (sonnet)");
    expect(modelName("claude", { local: "", claude: "" })).toBe("Claude Code");
    expect(modelName("local", { local: "qwen2.5", claude: "" })).toBe("the local brain (qwen2.5)");
  });
});
