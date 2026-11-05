import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATALOGUE,
  COMPONENTS,
  defaultOf,
  defaultRecipe,
  fillRecipe,
  optionsOf,
  propertiesOf,
  trimRecipe,
  VOCABULARY,
} from "./index";

const spec = JSON.parse(
  readFileSync(
    new URL("../../../../specs/plugin/v0/design-system.schema.json", import.meta.url),
    "utf8",
  ),
) as { $defs: Record<string, Record<string, unknown>> };
const defs = spec.$defs;
const defName = (component: string) => `Design${component[0]?.toUpperCase()}${component.slice(1)}`;

describe("the design system catalogue", () => {
  it("is the spec: the same components, properties, option lists and defaults", () => {
    const components = defs.DesignComponents?.properties as Record<string, { $ref: string }>;
    expect(Object.keys(components)).toEqual(COMPONENTS);
    for (const component of COMPONENTS) {
      expect(components[component]?.$ref).toBe(`#/$defs/${defName(component)}`);
      const props = defs[defName(component)]?.properties as Record<
        string,
        { $ref: string; description: string }
      >;
      expect(Object.keys(props)).toEqual(propertiesOf(component));
      for (const property of propertiesOf(component)) {
        const spec = (CATALOGUE as Record<string, Record<string, { enum: string }>>)[component]?.[
          property
        ];
        expect(props[property]?.$ref).toBe(`#/$defs/${spec?.enum}`);
        expect(props[property]?.description).toBe(`Default: ${defaultOf(component, property)}.`);
      }
    }
    for (const [name, values] of Object.entries(VOCABULARY)) {
      expect(defs[name]?.enum).toEqual(values);
    }
  });

  it("gives every property a default among its options", () => {
    for (const component of COMPONENTS) {
      for (const property of propertiesOf(component)) {
        expect(optionsOf(component, property)).toContain(defaultOf(component, property));
      }
    }
    expect(defaultRecipe().button).toMatchObject({ shape: "md", primary: "solid", size: "sm" });
  });

  it("fills a recipe over the defaults and drops what it does not know", () => {
    const filled = fillRecipe({
      button: { shape: "full", weight: "heavy", colour: "red" },
      carousel: { shape: "md" },
      field: "underline",
    });
    expect(filled.button.shape).toBe("full");
    expect(filled.button.weight).toBe("medium");
    expect(filled).not.toHaveProperty("carousel");
    expect(filled.field).toEqual(defaultRecipe().field);
    expect(fillRecipe(null)).toEqual(defaultRecipe());
  });

  it("trims a recipe to what differs from the endue design system", () => {
    expect(trimRecipe(defaultRecipe())).toEqual({});
    expect(trimRecipe({ button: { shape: "md", case: "uppercase" }, row: { size: "sm" } })).toEqual(
      { button: { case: "uppercase" } },
    );
  });
});
