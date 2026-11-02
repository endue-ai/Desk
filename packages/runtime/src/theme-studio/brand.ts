/**
 * "From an image" in the theme studio (docs/ko/theme-requirements.md TS-09): a logo or a screenshot
 * picked from disk (or dropped on the panel) is decoded and downsampled on the device and read for its
 * five main colours by @endue-ai/ui/theme's extractColors. The image never crosses the bridge or the
 * network; only colours leave this module. "Make a theme" builds a gated palette for both schemes
 * from them and opens the editor on it; "Describe with these" opens Describe with them added to its
 * sentence (TB-04: the sentence and the extracted colours).
 */
import type { ThemePackage } from "@endue-ai/bridge";
import { extractColors, type Pixels, paletteFrom, type Swatch } from "@endue-ai/ui/theme";
import { h, render } from "../shell/dom";
import type { StudioCopy } from "./copy";

export interface BrandDeps {
  tr(key: StudioCopy): string;
  /** Show the panel in the studio (its entry, the "From an image" button, was pressed). */
  open(): void;
  /** Open the editor on a new theme named `name`. */
  make(theme: ThemePackage, name: string): void;
  /** Back to the gallery. */
  back(): void;
  /** Open Describe with these colours added to its sentence. */
  describe(colors: string[]): void;
}

export interface BrandPanel {
  /** The gallery's "From an image" button. */
  entry: HTMLElement;
  element: HTMLElement;
  /** Draw the panel (the last image's colours kept) and focus on picking an image. */
  start(): void;
  /** The image's main colours, the most covering first: what Describe adds to its sentence. */
  colors(): string[];
}

/** The longest side an image is read at: enough for five colours, small enough to stay quick. */
const SIDE = 128;

/** A new theme from a brand's colours: a gated palette for each scheme, the colours on its card. */
export function brandTheme(colors: readonly string[]): ThemePackage {
  return {
    preview: colors.slice(0, 5),
    light: { colors: paletteFrom(colors, "light").colors },
    dark: { colors: paletteFrom(colors, "dark").colors },
  };
}

const dataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** The image as a bitmap, or (SVG, older engines) through an <img> on a data: URL the CSP allows. */
async function source(file: Blob): Promise<{ image: CanvasImageSource; w: number; h: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    return { image: bitmap, w: bitmap.width, h: bitmap.height };
  } catch {
    const img = new Image();
    img.src = await dataUrl(file);
    await img.decode();
    return { image: img, w: img.naturalWidth || SIDE, h: img.naturalHeight || SIDE };
  }
}

/** Decode `file` on the device at most SIDE pixels a side: the canvas drawn and its pixels. */
export async function readImage(
  file: Blob,
): Promise<{ canvas: HTMLCanvasElement; pixels: Pixels }> {
  const { image, w, h: height } = await source(file);
  const scale = Math.min(1, SIDE / Math.max(w, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2D canvas");
  // Nearest pixels, not blends: a logo's flat colours stay exactly what they are.
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if ("close" in image) image.close();
  return { canvas, pixels: context.getImageData(0, 0, canvas.width, canvas.height) };
}

export function createBrandPanel(deps: BrandDeps): BrandPanel {
  const { tr } = deps;
  let swatches: Swatch[] = [];
  let name = "";
  let thumb: HTMLCanvasElement | undefined;
  let note = "";
  const element = h("section", { class: "theme-brand", "aria-labelledby": "theme-brand-title" });

  const read = async (file: File) => {
    note = "";
    try {
      const { canvas, pixels } = await readImage(file);
      swatches = extractColors(pixels);
      thumb = canvas;
      name = file.name.replace(/\.[^.]+$/, "").trim();
      if (swatches.length === 0) note = tr("noColors");
    } catch (error) {
      swatches = [];
      thumb = undefined;
      note = `${tr("failed")}: ${error instanceof Error ? error.message : String(error)}`;
    }
    draw();
  };

  const picker = h("input", {
    type: "file",
    accept: "image/*",
    class: "sr-only",
    tabindex: "-1",
    "aria-hidden": "true",
    onChange: () => {
      const file = picker.files?.[0];
      picker.value = "";
      if (file) void read(file);
    },
  });
  const image = (event: DragEvent) =>
    [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
  element.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  element.addEventListener("drop", (event) => {
    const file = image(event);
    if (!file) return;
    event.preventDefault();
    void read(file);
  });

  const button = (key: string, label: StudioCopy, onClick: () => void) =>
    h("button", { type: "button", class: "btn btn-outline", "data-key": key, onClick }, tr(label));

  const draw = () =>
    render(element, () => [
      h("h3", { class: "theme-brand-title", id: "theme-brand-title" }, tr("fromImage")),
      h("p", { class: "theme-note" }, tr("fromImageHint")),
      h(
        "div",
        { class: "theme-brand-source" },
        button("pick-image", "pickImage", () => picker.click()),
        picker,
        thumb ? h("span", { class: "theme-brand-image" }, thumb, h("span", {}, name)) : null,
      ),
      swatches.length > 0
        ? h(
            "ol",
            { class: "theme-brand-swatches", "aria-label": tr("mainColors") },
            swatches.map((s) =>
              h(
                "li",
                {
                  class: "theme-brand-swatch",
                  "data-color": s.color,
                  style: { "--swatch": s.color },
                },
                h("span", { class: "theme-brand-chip", "aria-hidden": "true" }),
                h("code", {}, s.color),
                h("span", { class: "theme-brand-share" }, `${Math.round(s.share * 100)}%`),
              ),
            ),
          )
        : null,
      note ? h("p", { class: "theme-note", role: "status" }, note) : null,
      h(
        "div",
        { class: "theme-brand-actions" },
        button("brand-back", "back", () => deps.back()),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-outline",
            "data-key": "describe-colors",
            disabled: swatches.length === 0,
            onClick: () => deps.describe(swatches.map((s) => s.color)),
          },
          tr("describeWith"),
        ),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-primary",
            "data-key": "make-theme",
            disabled: swatches.length === 0,
            onClick: () => deps.make(brandTheme(swatches.map((s) => s.color)), name),
          },
          tr("makeTheme"),
        ),
      ),
    ]);

  return {
    entry: button("from-image", "fromImage", () => deps.open()),
    element,
    start() {
      draw();
      element.querySelector<HTMLElement>('[data-key="pick-image"]')?.focus();
    },
    colors: () => swatches.map((s) => s.color),
  };
}
