/**
 * The editor's sections, one per layer of a theme (ADR 0057): palette (by role group), material,
 * type, shape, motion and backdrop. Each control writes its field of the draft within the schema's
 * bounds and calls `changed`; values not set yet show what the desk would draw now.
 */
import type {
  ThemeDensity,
  ThemeImageFit,
  ThemeMotionPersonality,
  ThemePackage,
  ThemeRadius,
  ThemeShadow,
} from "@endue-ai/bridge";
import { RANGES } from "@endue-ai/ui/theme";
import { h } from "../shell/dom";
import type { StudioCopy } from "./copy";
import { type Scheme, setColor, slug, variantOf } from "./draft";
import { choiceField, colorField, fileField, rangeField, textField } from "./fields";

export interface SectionContext {
  draft: ThemePackage;
  scheme: Scheme;
  /** The tokens the desk draws with the draft now: what a field shows before it is set. */
  tokens: Readonly<Record<string, string>>;
  tr(key: StudioCopy): string;
  /** A file the person added: its path in the theme and its bytes. */
  addFile(path: string, bytes: Uint8Array): void;
  changed(rerender?: boolean): void;
}

const ANSI = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright black",
  "bright red",
  "bright green",
  "bright yellow",
  "bright blue",
  "bright magenta",
  "bright cyan",
  "bright white",
];

/** Palette groups: [copy key, token names]. */
export const PALETTE: ReadonlyArray<readonly [StudioCopy, readonly string[]]> = [
  ["surfaces", ["background", "card", "muted", "popover", "hover"]],
  ["textGroup", ["text", "textMuted"]],
  ["brand", ["primary", "primaryForeground"]],
  ["status", ["success", "warning", "danger", "info"]],
  ["structure", ["border", "input"]],
  ["floating", ["tooltip", "tooltipText", "scrim"]],
  ["charts", Array.from({ length: 8 }, (_, i) => `chart${i + 1}`)],
  ["terminal", Array.from({ length: 16 }, (_, i) => `ansi${i}`)],
  ["eris", ["eris", "erisGlow", "erisFrost", "erisShade"]],
];

const section = (title: string, key: string, ...rows: HTMLElement[]) =>
  h(
    "details",
    { class: "theme-section", "data-section": key, open: key === "palette" ? true : undefined },
    h("summary", { class: "theme-section-title" }, title),
    h("div", { class: "theme-section-body" }, rows),
  );

export function paletteSection(c: SectionContext): HTMLElement {
  const colors = c.draft[c.scheme]?.colors ?? {};
  return section(
    c.tr("palette"),
    "palette",
    ...PALETTE.map(([group, names]) =>
      h(
        "fieldset",
        { class: "theme-group" },
        h("legend", {}, c.tr(group)),
        names
          .filter((name) => colors[name] !== undefined || c.tokens[name] !== undefined)
          .map((name, i) =>
            colorField(
              group === "terminal" ? `${name} · ${ANSI[i] ?? ""}` : name,
              colors[name] ?? c.tokens[name] ?? "#000000",
              (value) => {
                setColor(c.draft, c.scheme, name, value);
                c.changed();
              },
              `color-${name}`,
            ),
          ),
      ),
    ),
  );
}

export function materialSection(c: SectionContext): HTMLElement {
  const variant = variantOf(c.draft, c.scheme);
  variant.material ??= {};
  const m = variant.material;
  const set = <K extends keyof typeof m>(key: K, value: (typeof m)[K]) => {
    m[key] = value;
    c.changed();
  };
  const num = (token: string, fallback: number) =>
    Number.parseFloat(c.tokens[token] ?? "") || fallback;
  return section(
    c.tr("material"),
    "material",
    rangeField(
      c.tr("opacity"),
      { min: RANGES.opacity[0], max: 1, step: 0.02, value: m.opacity ?? num("surfaceOpacity", 1) },
      (v) => set("opacity", v),
      "opacity",
    ),
    rangeField(
      c.tr("blur"),
      { min: 0, max: RANGES.blur[1], step: 1, value: m.blur ?? num("blur", 0), unit: "px" },
      (v) => set("blur", v),
      "blur",
    ),
    rangeField(
      c.tr("grain"),
      { min: 0, max: RANGES.noise[1], step: 0.01, value: m.noise ?? num("noise", 0) },
      (v) => set("noise", v),
      "noise",
    ),
    rangeField(
      c.tr("border"),
      {
        min: 0,
        max: RANGES.border[1],
        step: 1,
        value: m.border ?? num("borderWidth", 1),
        unit: "px",
      },
      (v) => set("border", v),
      "border",
    ),
    choiceField(
      c.tr("shadow"),
      [
        ["none", "none"],
        ["soft", "soft"],
        ["strong", "strong"],
      ],
      m.shadow ?? "soft",
      (v) => set("shadow", v as ThemeShadow),
      "shadow",
    ),
  );
}

export function typeSection(c: SectionContext): HTMLElement {
  c.draft.type ??= {};
  const type = c.draft.type;
  const set = <K extends keyof typeof type>(key: K, value: (typeof type)[K]) => {
    type[key] = value;
    c.changed();
  };
  return section(
    c.tr("type"),
    "type",
    textField(c.tr("sans"), type.sans ?? c.tokens.fontSans ?? "", (v) => set("sans", v), "sans"),
    textField(c.tr("mono"), type.mono ?? c.tokens.fontMono ?? "", (v) => set("mono", v), "mono"),
    rangeField(
      c.tr("scale"),
      { min: RANGES.scale[0], max: RANGES.scale[1], step: 0.05, value: type.scale ?? 1, unit: "×" },
      (v) => set("scale", v),
      "scale",
    ),
    rangeField(
      c.tr("tracking"),
      {
        min: RANGES.tracking[0],
        max: RANGES.tracking[1],
        step: 0.005,
        value: type.tracking ?? 0,
        unit: "em",
      },
      (v) => set("tracking", v),
      "tracking",
    ),
    ...(type.fonts ?? []).map((font, i) =>
      textField(
        `${c.tr("fontFamily")} · ${font.src}`,
        font.family,
        (v) => {
          const fonts = [...(type.fonts ?? [])];
          fonts[i] = { ...font, family: v.replace(/[^A-Za-z0-9 ._-]/g, "") || font.family };
          set("fonts", fonts);
        },
        `font-${i}`,
      ),
    ),
    fileField(
      c.tr("addFont"),
      ".woff2",
      (name, bytes) => {
        const family =
          name
            .replace(/\.woff2$/i, "")
            .replace(/[^A-Za-z0-9 ._-]/g, " ")
            .trim() || "Theme";
        const path = `fonts/${slug(family)}.woff2`;
        c.addFile(path, bytes);
        set("fonts", [...(type.fonts ?? []).filter((f) => f.src !== path), { family, src: path }]);
        c.changed(true);
      },
      "font-file",
    ),
    h("p", { class: "theme-note" }, c.tr("fontsAfterSave")),
  );
}

export function shapeMotionSection(c: SectionContext): HTMLElement {
  c.draft.shape ??= {};
  const shape = c.draft.shape;
  c.draft.motion ??= {};
  const motion = c.draft.motion;
  return section(
    `${c.tr("shape")} · ${c.tr("motion")}`,
    "shape",
    choiceField(
      c.tr("radius"),
      [
        ["none", "none"],
        ["subtle", "subtle"],
        ["soft", "soft"],
        ["round", "round"],
      ],
      shape.radius ?? "soft",
      (v) => {
        shape.radius = v as ThemeRadius;
        c.changed();
      },
      "radius",
    ),
    choiceField(
      c.tr("density"),
      [
        ["compact", "compact"],
        ["comfortable", "comfortable"],
        ["spacious", "spacious"],
      ],
      shape.density ?? "comfortable",
      (v) => {
        shape.density = v as ThemeDensity;
        c.changed();
      },
      "density",
    ),
    choiceField(
      c.tr("personality"),
      [
        ["snappy", "snappy"],
        ["smooth", "smooth"],
        ["calm", "calm"],
      ],
      motion.personality ?? "smooth",
      (v) => {
        motion.personality = v as ThemeMotionPersonality;
        c.changed();
      },
      "personality",
    ),
  );
}

export function backdropSection(c: SectionContext): HTMLElement {
  const variant = variantOf(c.draft, c.scheme);
  variant.backdrop ??= {};
  const b = variant.backdrop;
  const kind = b.image ? "image" : b.gradient ? "gradient" : b.color ? "color" : "none";
  const fallback = c.tokens.background ?? "#000000";
  const rows: HTMLElement[] = [
    choiceField(
      c.tr("backdropKind"),
      [
        ["none", c.tr("none")],
        ["color", c.tr("color")],
        ["gradient", c.tr("gradient")],
        ["image", c.tr("image")],
      ],
      kind,
      (v) => {
        delete b.image;
        delete b.gradient;
        delete b.color;
        if (v === "color") b.color = fallback;
        if (v === "gradient") b.gradient = [fallback, c.tokens.card ?? fallback];
        c.changed(true);
      },
      "backdrop-kind",
    ),
  ];
  if (kind === "color")
    rows.push(
      colorField(
        c.tr("color"),
        b.color ?? fallback,
        (v) => {
          b.color = v;
          c.changed();
        },
        "backdrop-color",
      ),
    );
  if (kind === "gradient") {
    for (const [i, stop] of (b.gradient ?? []).entries()) {
      rows.push(
        colorField(
          `${c.tr("gradient")} ${i + 1}`,
          stop,
          (v) => {
            const stops = [...(b.gradient ?? [])];
            stops[i] = v;
            b.gradient = stops;
            c.changed();
          },
          `gradient-${i}`,
        ),
      );
    }
    rows.push(
      rangeField(
        c.tr("angle"),
        { min: 0, max: 360, step: 5, value: b.angle ?? 180, unit: "°" },
        (v) => {
          b.angle = v;
          c.changed();
        },
        "angle",
      ),
    );
  }
  if (kind === "image" || kind === "none")
    rows.push(
      fileField(
        c.tr("addImage"),
        ".png,.jpg,.jpeg,.webp",
        (name, bytes) => {
          const ext = (/\.(png|jpe?g|webp)$/i.exec(name)?.[1] ?? "png").toLowerCase();
          const path = `images/${slug(name.replace(/\.[^.]+$/, ""))}.${ext}`;
          c.addFile(path, bytes);
          delete b.gradient;
          delete b.color;
          b.image = path;
          c.changed(true);
        },
        "backdrop-image",
      ),
    );
  if (kind === "image")
    rows.push(
      choiceField(
        c.tr("fit"),
        [
          ["cover", "cover"],
          ["tile", "tile"],
        ],
        b.fit ?? "cover",
        (v) => {
          b.fit = v as ThemeImageFit;
          c.changed();
        },
        "fit",
      ),
    );
  rows.push(
    colorField(
      c.tr("glow"),
      b.glow ?? c.tokens.glow ?? fallback,
      (v) => {
        b.glow = v;
        c.changed();
      },
      "glow",
    ),
  );
  return section(c.tr("backdrop"), "backdrop", ...rows);
}
