import { fillRecipe } from "@endue-ai/ui/design";
import { describe, expect, it, vi } from "vitest";
import type { CommandSpec, Commands } from "../commands";
import type { RuntimeDesigns } from "./design";
import { catalogueOptions, designCommands } from "./design-commands";

function setup() {
  const specs = new Map<string, CommandSpec>();
  const commands = {
    define: (id: string, spec: CommandSpec) => {
      specs.set(id, spec);
      return () => specs.delete(id);
    },
  } as unknown as Commands;
  let active = "";
  const installed = [
    {
      id: "endue.design-soft",
      name: "Soft",
      designSystem: { components: { button: { shape: "full" as const } } },
    },
    { id: "local.mine", name: "Mine", description: "Mine.", designSystem: { components: {} } },
  ];
  const designs = {
    active: () => active,
    installed: () => installed,
    apply: vi.fn((id: string) => {
      active = id;
    }),
    resolve: (id: string) => ({
      id,
      recipe: fillRecipe(installed.find((d) => d.id === id)?.designSystem.components),
      tokens: {},
    }),
    change: vi.fn(async () => "local.soft-custom"),
    io: () => ({
      exportDesign: async (id: string) => `~/Downloads/${id}.desk-design`,
      importPath: async () => "local.shared",
    }),
  } as unknown as RuntimeDesigns;
  const off = designCommands(commands, designs);
  const run = (id: string, args?: unknown) => specs.get(id)?.run(args, {});
  return { specs, designs, run, off };
}

describe("desk.design.* commands", () => {
  it("offers agents list, get, use, set, export and import, each described and none requiring args", () => {
    const { specs } = setup();
    const agents = [...specs].filter(([, spec]) => spec.agent).map(([id]) => id);
    expect(agents).toEqual([
      "desk.design.list",
      "desk.design.get",
      "desk.design.use",
      "desk.design.set",
      "desk.design.export",
      "desk.design.import",
    ]);
    for (const [id, spec] of specs) {
      expect(spec.owner, id).toBe("desk.design");
      expect(JSON.stringify(spec.agent?.args ?? {}), id).not.toContain('"required"');
    }
    expect(specs.get("desk.design.list")?.agent?.readOnly).toBe(true);
    expect(specs.get("desk.design.get")?.agent?.readOnly).toBe(true);
    expect(specs.get("desk.design.set")?.agent?.readOnly).toBeUndefined();
  });

  it("lists the endue design system first and tells built-in from the person's", () => {
    const { run } = setup();
    expect(run("desk.design.list")).toEqual({
      active: "",
      designSystems: [
        { id: "", name: "endue", builtIn: true },
        { id: "endue.design-soft", name: "Soft", builtIn: true, mine: false },
        { id: "local.mine", name: "Mine", description: "Mine.", builtIn: false, mine: true },
      ],
    });
  });

  it("gets a design system's full recipe with every option the catalogue allows", () => {
    const { run } = setup();
    const got = run("desk.design.get", { id: "endue.design-soft" }) as {
      components: { button: { shape: string } };
      options: Record<string, Record<string, string[]>>;
    };
    expect(got.components.button.shape).toBe("full");
    expect(got.options).toEqual(catalogueOptions());
    expect(got.options.field?.style).toEqual(["outline", "filled", "underline"]);
  });

  it("uses only an installed design system, else the endue one", () => {
    const { run, designs } = setup();
    expect(run("desk.design.use", { id: "endue.design-soft" })).toEqual({
      active: "endue.design-soft",
    });
    run("desk.design.use", { id: "example.nothing" });
    expect(designs.apply).toHaveBeenLastCalledWith("");
  });

  it("sets components through the policy, and a bare run changes nothing", async () => {
    const { run, designs } = setup();
    expect(await run("desk.design.set")).toEqual({ id: "" });
    expect(designs.change).not.toHaveBeenCalled();
    const changes = { button: { shape: "none" } };
    expect(await run("desk.design.set", { components: changes, name: "Square" })).toEqual({
      id: "local.soft-custom",
    });
    expect(designs.change).toHaveBeenCalledWith(changes, "Square");
  });

  it("exports the one in force and imports a shared file by path", async () => {
    const { run } = setup();
    run("desk.design.use", { id: "local.mine" });
    expect(await run("desk.design.export")).toEqual({ path: "~/Downloads/local.mine.desk-design" });
    expect(await run("desk.design.import", { path: "~/Shared/blueprint.desk-design" })).toEqual({
      id: "local.shared",
    });
    await expect(run("desk.design.import")).rejects.toThrow("needs { path }");
  });
});
