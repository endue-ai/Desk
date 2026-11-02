/**
 * What Describe sends the brain (docs/ko/theme-requirements.md TB-04): the propose_theme tool and a
 * prompt of four parts, nothing else: the rules (what each colour role is for, the contrast pairs and
 * the ranges, from @endue-ai/ui/theme and docs/design-system.md), the theme block's schema, the values
 * of the theme in force, and the person's sentence on the last line. Refining puts the proposal to
 * change before the sentence. No files, paths or pictures of the screen. DOM-free.
 */
import type { BrainAskTool } from "@endue-ai/bridge";
import {
  DENSITY,
  MOTION,
  NON_TEXT_PAIRS,
  RADIUS,
  RANGES,
  SHADOW,
  TEXT_PAIRS,
} from "@endue-ai/ui/theme";
import themeSchema from "../../../../specs/plugin/v0/theme.schema.json";
import type { Proposal } from "./proposal";

/** The tool the brain answers with: a theme block (ThemePackage), a name and a line about it. */
export const PROPOSE_THEME: BrainAskTool = {
  name: "propose_theme",
  description:
    "Propose a desk theme for what the person described: a short name, one line about it, and the theme block (ThemePackage), following the rules and the schema in the prompt.",
  schema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 80 },
      description: { type: "string", maxLength: 400 },
      theme: { $ref: "https://endue.ai/specs/plugin/v0/theme.schema.json#/$defs/ThemePackage" },
    },
    required: ["name", "description", "theme"],
    additionalProperties: false,
  },
};

/** The theme in force, as the prompt shows it: its name, its scheme and its tokens. */
export interface CurrentTheme {
  name: string;
  scheme: "light" | "dark";
  tokens: Readonly<Record<string, string>>;
}

/** The colour roles by token name (docs/design-system.md, "Color roles"). */
const ROLES = [
  "background, card, muted, popover, hover: the surfaces (the page, panels and windows, sunken areas, overlays, the hovered row)",
  "text, textMuted: body and secondary text on the surfaces",
  "primary, primaryForeground, primaryHover: the main action's fill, the ink on that fill, the fill on hover",
  "primaryText, primarySubtle, primarySoft, primaryBorder: the brand on neutral surfaces (links, tints, borders)",
  "success, warning, danger, info: status fills; each has a Foreground (ink on the fill), a Text (on the surfaces), a Soft tint and a Border",
  "border, input, ring: dividers, control borders, the keyboard focus ring",
  "tooltip, tooltipText, scrim: floating layers and their text",
  "chart1 to chart8: one steady colour per subject, in order",
  "eris and the eris* tokens: Eris, the desk's companion; leave them out to keep hers",
];

/** The values a prompt carries of the theme in force: the roles and the shared scale. */
const CURRENT = [
  ...["background", "card", "muted", "popover", "hover", "text", "textMuted"],
  ...[
    "primary",
    "primaryForeground",
    "primaryHover",
    "primaryText",
    "primarySoft",
    "primaryBorder",
  ],
  ...["success", "warning", "danger", "info", "border", "input", "ring", "tooltip", "tooltipText"],
  ...["fontSans", "fontMono", "radiusMd", "controlMd", "motionBase", "easing"],
  ...["surfaceOpacity", "blur", "noise", "borderWidth", "backdrop", "glow"],
];

const pair = ([fg, ground, layer]: readonly [string, string, string?]) =>
  layer ? `${fg}/${ground}+${layer}` : `${fg}/${ground}`;
const names = (presets: object) => Object.keys(presets).join(" | ");
const range = (name: string, [lo, hi]: readonly [number, number], unit = "") =>
  `${name} ${lo}–${hi}${unit}`;

const RULES = [
  "- Answer by calling propose_theme once with { name, description, theme }. theme is a ThemePackage (the schema below). Give light and dark unless the sentence asks for one; token names are camelCase, colours #rrggbb.",
  "- Colour roles:",
  ...ROLES.map((role) => `  - ${role}`),
  `- Contrast: each pair is foreground/ground (+ a translucent layer over the ground). Text needs 4.5:1: ${TEXT_PAIRS.map(pair).join(", ")}. Borders and fills need 3:1: ${NON_TEXT_PAIRS.map(pair).join(", ")}. The desk moves a failing foreground's lightness until it passes, so choose pairs that pass.`,
  `- Ranges: ${[
    range("material.opacity", RANGES.opacity),
    range("material.blur", RANGES.blur, "px"),
    range("material.noise", RANGES.noise),
    range("material.border", RANGES.border, "px"),
    range("backdrop.angle", RANGES.angle),
    range("type.scale", RANGES.scale),
    range("type.tracking", RANGES.tracking, "em"),
  ].join(", ")}.`,
  `- Presets: shape.radius ${names(RADIUS)}; shape.density ${names(DENSITY)}; motion.personality ${names(MOTION)}; material.shadow ${names(SHADOW)}.`,
  "- No files: leave out type.fonts and backdrop.image; font stacks name fonts the system has.",
].join("\n");

/** The theme block's definitions (specs/plugin/v0/theme.schema.json), without the bundle format. */
const SCHEMA = JSON.stringify(
  Object.fromEntries(
    Object.entries(themeSchema.$defs).filter(([name]) => !/^Theme(Bundle|AssetData)$/.test(name)),
  ),
);

/** A sentence as one line: spaces and line breaks collapsed, at most 2000 characters. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 2000);
}

/** The values of the theme in force the brain may read: no URLs (a theme's image is a path). */
function currentValues(current: CurrentTheme): string {
  const tokens: Record<string, string> = {};
  for (const name of CURRENT) {
    const value = current.tokens[name];
    if (value !== undefined && !/url\(/i.test(value)) tokens[name] = value;
  }
  return JSON.stringify({ name: current.name, scheme: current.scheme, tokens });
}

/** The prompt: rules, schema, current values, the proposal when refining, and the sentence last. */
export function describePrompt(input: {
  sentence: string;
  current: CurrentTheme;
  proposal?: Proposal;
}): string {
  const parts = [
    `## Rules\n${RULES}`,
    `## Schema\nThe theme block's JSON Schema definitions (2020-12); theme follows ThemePackage.\n${SCHEMA}`,
    `## Current theme\nWhat the desk shows now.\n${currentValues(input.current)}`,
  ];
  if (input.proposal) {
    parts.push(
      `## Proposal\nThe theme to change: keep what the sentence does not ask to change.\n${JSON.stringify(input.proposal)}`,
    );
  }
  parts.push(`## Sentence\nWhat the person wants, on the last line.\n${oneLine(input.sentence)}`);
  return parts.join("\n\n");
}
