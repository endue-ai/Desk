/**
 * The desk theme's fonts in a plugin frame: each one a FontFace in `document.fonts` (the frame's CSP
 * allows fonts from the plugin scheme), the previous theme's removed when the theme changes. The
 * runtime does the same for the shell (packages/runtime/src/theme-fonts.ts).
 */

/** A font of the active theme, as the desk shares it. */
export interface ThemeFont {
  family: string;
  url: string;
  weight?: string;
  style?: string;
}

type Faces = { add(face: FontFace): unknown; delete(face: FontFace): unknown };
type FaceConstructor = new (
  family: string,
  source: string,
  descriptors?: FontFaceDescriptors,
) => FontFace;

const loaded = new WeakMap<object, Map<string, FontFace>>();
const key = (f: ThemeFont) => [f.family, f.url, f.weight ?? "", f.style ?? ""].join("\u0000");

/** Make `fonts` the theme's fonts in `set`: add what is new, remove what is gone. */
export function applyFonts(
  set: Faces | undefined,
  Face: FaceConstructor | undefined,
  fonts: readonly ThemeFont[],
): void {
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
