/**
 * The active theme's fonts in a document (TH-08): each one a FontFace in `document.fonts`, so a CSP
 * without inline styles still loads them; the previous theme's faces leave when the theme changes. The
 * plugin SDK does the same in every frame.
 */
import type { ThemeFontFace } from "@endue-ai/ui/theme";

/** What this needs of a document: its font set and the FontFace constructor. */
export interface FontHost {
  fonts: { add(face: FontFace): unknown; delete(face: FontFace): unknown } | undefined;
  FontFace:
    | (new (
        family: string,
        source: string,
        descriptors?: FontFaceDescriptors,
      ) => FontFace)
    | undefined;
}

const loaded = new WeakMap<object, Map<string, FontFace>>();
const key = (f: ThemeFontFace) => [f.family, f.url, f.weight ?? "", f.style ?? ""].join("\u0000");

/** The document's own font set and constructor, when the browser has them. */
export function fontHost(doc: Document): FontHost {
  const win = doc.defaultView as (Window & { FontFace?: FontHost["FontFace"] }) | null;
  return { fonts: doc.fonts, FontFace: win?.FontFace };
}

/** Make `fonts` the theme fonts of `host`: add what is new, remove what is gone. */
export function applyThemeFonts(host: FontHost, fonts: readonly ThemeFontFace[]): void {
  const set = host.fonts;
  const Face = host.FontFace;
  if (!set || !Face) return;
  const have = loaded.get(set) ?? new Map<string, FontFace>();
  const want = new Map(fonts.map((f) => [key(f), f]));
  for (const [k, face] of have) {
    if (want.has(k)) continue;
    set.delete(face);
    have.delete(k);
  }
  for (const [k, f] of want) {
    if (have.has(k)) continue;
    const face = new Face(f.family, `url("${f.url.replace(/["\\]/g, "")}")`, {
      ...(f.weight ? { weight: f.weight } : {}),
      ...(f.style ? { style: f.style } : {}),
      display: "swap",
    });
    set.add(face);
    face.load().catch(() => undefined);
    have.set(k, face);
  }
  loaded.set(set, have);
}
