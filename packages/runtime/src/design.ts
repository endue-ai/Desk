/**
 * Design systems (ADR 0090, docs/ko/design-system-requirements.md DH): what the desk's components are
 * made of. desk.design.active names an installed plugin of kind design-system (empty for the endue
 * design system); its recipe compiles into component tokens (`@endue-ai/ui/design`) that the theme
 * engine lays over the theme's tokens, so the shell and every frame get both at once (DH-06).
 */
import type { DesignSystemPackage } from "@endue-ai/bridge";
import { compileDesignSystem, type FullRecipe, fillRecipe } from "@endue-ai/ui/design";

/** An installed design system that desk.design.active can name. */
export interface InstalledDesign {
  id: string;
  name: string;
  description?: string;
  designSystem: DesignSystemPackage;
}

/** The design system in force (or previewed): which one, its full recipe and its component tokens. */
export interface DesignState {
  /** The design system plugin in force; empty for the endue design system. */
  id: string;
  recipe: FullRecipe;
  tokens: Record<string, string>;
}

/** The id a draft (the studio's editor, Describe, a market preview) is previewed under. */
export const DRAFT_DESIGN = "local.design-draft";

/** The design system `id` names among `installed`, or the endue design system when none does. */
export function resolveDesign(installed: readonly InstalledDesign[], id: string): DesignState {
  const chosen = id ? installed.find((design) => design.id === id) : undefined;
  const components = chosen?.designSystem.components;
  return {
    id: chosen?.id ?? "",
    recipe: fillRecipe(components),
    tokens: compileDesignSystem(components),
  };
}
