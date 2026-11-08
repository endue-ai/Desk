/**
 * desk.design.* commands (DE-01): the same commands for the palette, people and agents, so Eris lists,
 * reads, chooses and changes design systems as a person does (ADR 0088). The agent fields say what each
 * takes and answers; the catalogue's option lists travel in desk.design.get, so an agent never guesses.
 */
import { COMPONENTS, optionsOf, propertiesOf } from "@endue-ai/ui/design";
import type { AgentSpec, Commands } from "../commands";
import type { RuntimeDesigns } from "./design";

const string = (args: unknown, name: string) => {
  const value = (args as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" ? value : undefined;
};

/** Every component's properties and their options, as an agent reads them. */
export function catalogueOptions(): Record<string, Record<string, readonly string[]>> {
  const out: Record<string, Record<string, readonly string[]>> = {};
  for (const component of COMPONENTS) {
    out[component] = {};
    for (const property of propertiesOf(component)) {
      (out[component] as Record<string, readonly string[]>)[property] = optionsOf(
        component,
        property,
      );
    }
  }
  return out;
}

/** The components schema an agent fills: every component and property optional, options enumerated. */
export function componentsSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const component of COMPONENTS) {
    const props: Record<string, unknown> = {};
    for (const property of propertiesOf(component)) {
      props[property] = { type: "string", enum: [...optionsOf(component, property)] };
    }
    properties[component] = { type: "object", properties: props, additionalProperties: false };
  }
  return { type: "object", properties, additionalProperties: false };
}

const ID = {
  type: "string",
  description: "A design system's id; empty for the endue design system.",
};

export function designCommands(commands: Commands, designs: RuntimeDesigns): () => void {
  const listed = () => ({
    active: designs.active(),
    designSystems: [
      { id: "", name: "endue", builtIn: true },
      ...designs.installed().map((d) => ({
        id: d.id,
        name: d.name,
        ...(d.description ? { description: d.description } : {}),
        builtIn: !/^(local|market)\./.test(d.id),
        mine: d.id.startsWith("local."),
      })),
    ],
  });
  const define = (
    id: string,
    title: string,
    run: (args: unknown) => unknown,
    keywords: string[],
    agent?: AgentSpec,
  ) =>
    commands.define(id, {
      title,
      keywords: ["design system", "design", "components", "디자인 시스템", ...keywords],
      owner: "desk.design",
      run,
      ...(agent ? { agent } : {}),
    });
  const offs = [
    define("desk.design.list", "List design systems", listed, ["list"], {
      description:
        "The design systems this desk has (the endue one has the empty id) and the one in force. A design system decides what every component of the desk is made of (corners, sizes, fills, borders); a theme decides the colours and values. Choose one with desk.design.use; change components with desk.design.set.",
      result: { type: "object" },
      readOnly: true,
    }),
    define(
      "desk.design.get",
      "Show a design system's components",
      (args) => {
        const id = string(args, "id") ?? designs.active();
        const found = designs.installed().find((d) => d.id === id);
        return {
          id: found ? id : "",
          name: found?.name ?? "endue",
          components: designs.resolve(id).recipe,
          options: catalogueOptions(),
        };
      },
      ["components", "recipe"],
      {
        description:
          "One design system's choices for every component (the one in force when id is absent), and every option the catalogue allows per component property: what desk.design.set takes.",
        args: { type: "object", properties: { id: ID }, additionalProperties: false },
        result: { type: "object" },
        readOnly: true,
      },
    ),
    define(
      "desk.design.use",
      "Use a design system",
      (args) => {
        const id = string(args, "id") ?? "";
        designs.apply(designs.installed().some((d) => d.id === id) ? id : "");
        return { active: designs.active() };
      },
      ["use", "apply", "switch"],
      {
        description:
          "Put a design system in force on the whole desk, by its id from desk.design.list (empty for the endue design system). Nothing is lost: the earlier one stays installed.",
        args: { type: "object", properties: { id: ID }, additionalProperties: false },
      },
    ),
    define("desk.design.default", "Use the endue design system", () => designs.apply(""), [
      "endue",
      "reset",
    ]),
    define(
      "desk.design.set",
      "Change the components of the design system in force",
      async (args) => {
        const components = (args as { components?: unknown } | undefined)?.components;
        // A bare run (the palette's) changes nothing; the args say what to change.
        if (!components || typeof components !== "object" || Object.keys(components).length === 0)
          return { id: designs.active() };
        return { id: await designs.change(components as never, string(args, "name")) };
      },
      ["change", "customize", "tune"],
      {
        description:
          "Change some components of the design system in force, for example { components: { button: { shape: 'full' }, field: { style: 'underline' } } }. The person's own design system (id local.*) is changed in place; any other is copied into a new one of the person's (named by name), which is put in force. Options are those desk.design.get lists; anything else is ignored. Answers the id in force.",
        args: {
          type: "object",
          properties: {
            components: componentsSchema(),
            name: { type: "string", description: "The name of a new copy, when one is made." },
          },
          additionalProperties: false,
        },
        result: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    ),
    define(
      "desk.design.export",
      "Export a design system",
      async (args) => ({
        path: await designs.io().exportDesign(string(args, "id") ?? designs.active()),
      }),
      ["export", "share", "file"],
      {
        description:
          "Write a design system (the one in force when id is absent; not the endue one) as a .desk-design file in Downloads to share, and answer its path.",
        args: { type: "object", properties: { id: ID }, additionalProperties: false },
        result: { type: "object", properties: { path: { type: "string" } } },
      },
    ),
    define(
      "desk.design.import",
      "Import a design system",
      async (args) => {
        const path = string(args, "path");
        if (!path) throw new Error("desk.design.import needs { path }");
        return { id: await designs.io().importPath(path) };
      },
      ["import", "file", "shared"],
      {
        description:
          "Install a .desk-design file someone shared, by its path, as one of the person's design systems. It is not put in force: desk.design.use does that.",
        args: {
          type: "object",
          properties: { path: { type: "string", description: "The .desk-design file's path." } },
          additionalProperties: false,
        },
        result: { type: "object", properties: { id: { type: "string" } } },
      },
    ),
  ];
  return () => {
    for (const off of offs) off();
  };
}
