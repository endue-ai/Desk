/**
 * The named presets of a theme's shape, motion and material layers, as the tokens they set (ADR 0057).
 * The middle preset of each is the desk's design today, so a theme that names it changes nothing.
 */
import type {
  ThemeDensity,
  ThemeMotionPersonality,
  ThemeRadius,
  ThemeShadow,
} from "@endue-ai/bridge";

export const RADIUS: Record<ThemeRadius, Record<string, string>> = {
  none: { radiusSm: "0px", radiusMd: "0px", radiusLg: "0px" },
  subtle: { radiusSm: "2px", radiusMd: "4px", radiusLg: "6px" },
  soft: { radiusSm: "4px", radiusMd: "8px", radiusLg: "12px" },
  round: { radiusSm: "6px", radiusMd: "12px", radiusLg: "18px" },
};

export const DENSITY: Record<ThemeDensity, Record<string, string>> = {
  compact: { controlXs: "24px", controlSm: "28px", controlMd: "36px", controlLg: "44px" },
  comfortable: { controlXs: "28px", controlSm: "32px", controlMd: "40px", controlLg: "48px" },
  spacious: { controlXs: "32px", controlSm: "36px", controlMd: "44px", controlLg: "52px" },
};

export const MOTION: Record<ThemeMotionPersonality, Record<string, string>> = {
  snappy: {
    motionFast: "100ms",
    motionBase: "150ms",
    motionSlow: "250ms",
    motionTheme: "200ms",
    easing: "cubic-bezier(0.2, 0, 0, 1)",
  },
  smooth: {
    motionFast: "150ms",
    motionBase: "220ms",
    motionSlow: "400ms",
    motionTheme: "350ms",
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  },
  calm: {
    motionFast: "220ms",
    motionBase: "320ms",
    motionSlow: "560ms",
    motionTheme: "500ms",
    easing: "cubic-bezier(0.33, 1, 0.68, 1)",
  },
};

/** Elevation presets; soft keeps the scheme's own shadow tokens. */
export const SHADOW: Record<ThemeShadow, Record<string, string>> = {
  none: { shadowSm: "none", shadowMd: "none", shadowLg: "none" },
  soft: {},
  strong: {
    shadowSm: "0 1px 3px rgba(0, 0, 0, 0.5)",
    shadowMd: "0 12px 32px rgba(0, 0, 0, 0.55)",
    shadowLg: "0 28px 64px rgba(0, 0, 0, 0.65)",
  },
};

/** The bounds of a theme's numbers (specs/plugin/v0/theme.schema.json), for values that skipped the schema. */
export const RANGES = {
  opacity: [0.6, 1],
  blur: [0, 24],
  noise: [0, 0.15],
  border: [0, 2],
  angle: [0, 360],
  scale: [0.85, 1.25],
  tracking: [-0.02, 0.05],
} as const satisfies Record<string, readonly [number, number]>;
