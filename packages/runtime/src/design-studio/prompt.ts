/**
 * What Describe sends the brain for a design system (DS-06): the propose_design_system tool and a prompt
 * of three parts: the rules (what a design system decides, each component and its options), the choices
 * of the design system in force, and the person's sentence on the last line. Refining puts the proposal
 * to change before the sentence. No files, paths or pictures of the screen. DOM-free.
 */
import type { BrainAskTool } from "@endue-ai/bridge";
import {
  COMPONENTS,
  type DesignRecipe,
  type FullRecipe,
  mergeRecipe,
  optionsOf,
  propertiesOf,
  trimRecipe,
} from "@endue-ai/ui/design";
import { componentsSchema } from "../policies/design-commands";

/** The tool the brain answers with: a name, a line about it and the components it changes. */
export const PROPOSE_DESIGN: BrainAskTool = {
  name: "propose_design_system",
  description:
    "Propose a desk design system for what the person described: a short name, one line about it, and the components whose options change, following the rules in the prompt.",
  schema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 80 },
      description: { type: "string", maxLength: 400 },
      components: componentsSchema(),
    },
    required: ["name", "description", "components"],
    additionalProperties: false,
  },
};

const RULES = [
  "A design system decides what each component of the desk is made of: which corner, height, fill, border and weight it uses. It holds no colours or sizes of its own: the theme in force gives those, so every choice works with every theme.",
  "Shapes: none (square), sm, md, lg (the theme's radius steps) or full (a pill). Sizes: xs, sm, md, lg (the theme's control heights). Elevation: none or the theme's shadow steps.",
  "button.primary is how the main action fills (solid, a soft tint, or an outline); danger buttons follow it. button.secondary is how other buttons show (outline, soft fill, or ghost).",
  "Name only what the sentence asks to change; everything left out stays as it is in force.",
];

/** The prompt for `sentence` over `current` (the recipe in force), refining `proposal` if given. */
export function designPrompt(
  sentence: string,
  current: FullRecipe,
  proposal?: { name: string; components: DesignRecipe },
): string {
  const options = COMPONENTS.map(
    (component) =>
      `${component}: ${propertiesOf(component)
        .map((property) => `${property} (${optionsOf(component, property).join(" | ")})`)
        .join(", ")}`,
  );
  const base = proposal ? mergeRecipe(current, proposal.components) : current;
  return [
    "Rules:",
    ...RULES.map((rule) => `- ${rule}`),
    "",
    "Components and their options:",
    ...options,
    "",
    `In force now (only what differs from the endue design system): ${JSON.stringify(trimRecipe(base))}`,
    ...(proposal ? [`Refine the proposal "${proposal.name}" above with this sentence.`] : []),
    "",
    `The person says: ${sentence}`,
  ].join("\n");
}

/** What the brain answered, cleaned: a name, a line and the components (unknown options dropped). */
export function cleanDesignProposal(
  structured: Record<string, unknown> | undefined,
): { name: string; description: string; components: DesignRecipe } | undefined {
  if (!structured) return undefined;
  const name = typeof structured.name === "string" ? structured.name.trim().slice(0, 80) : "";
  if (!name) return undefined;
  const description =
    typeof structured.description === "string" ? structured.description.trim().slice(0, 400) : "";
  return { name, description, components: trimRecipe(structured.components) };
}
