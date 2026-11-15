/**
 * desk.settings.find: the palette's Settings group (#304), a palette provider the desk defines
 * itself (`policies/palette.ts`). The sections whose words hold the query, then the rows: the one
 * for the palette's own key in Keyboard (`global-key.ts`) and those drawn from what plugins and the
 * core declare (`declared.ts`). Each opens Settings at its section and row (`revealRow`).
 */

import { type SettingsLanguage, settingsText } from "./copy";
import { type DeclaredDeps, declaredRows } from "./declared";
import { PALETTE_KEY } from "./global-key";
import { findSections, type SettingsSection } from "./panels";

export const FIND = "desk.settings.find";
export const OPEN = "desk.settings.open";
/** As many results as a provider gives when the palette asks for no number (`providers.js`). */
const LIMIT = 5;

export interface FindDeps {
  hub: DeclaredDeps["hub"];
  language: SettingsLanguage;
}

interface Found {
  id: string;
  title: string;
  detail: string;
  kind: "setting";
  actions: { command: string; title: string; args: { section: SettingsSection; row?: string } }[];
}

/** The sections and rows whose words hold every word of `query`, sections first, at most `limit`. */
export function settingsResults(query: string, deps: FindDeps, limit = LIMIT): Found[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const tr = (key: Parameters<typeof settingsText>[1]) => settingsText(deps.language, key);
  const result = (
    id: string,
    title: string,
    detail: string,
    section: SettingsSection,
    row?: string,
  ) =>
    ({
      id,
      title,
      detail,
      kind: "setting",
      actions: [
        { command: OPEN, title: tr("openInSettings"), args: row ? { section, row } : { section } },
      ],
    }) satisfies Found;
  const sections = findSections(query).map((section) =>
    result(`settings:${section}`, tr(section), tr("title"), section),
  );
  const own = {
    key: PALETTE_KEY,
    title: tr("paletteKey"),
    group: "",
    section: "keyboard" as const,
    words: [PALETTE_KEY, tr("paletteKey"), tr("paletteKeyHint"), "shortcut global hotkey"]
      .join(" ")
      .toLowerCase(),
  };
  const rows = [own, ...declaredRows(deps.hub)]
    .filter((row) => words.every((word) => row.words.includes(word)))
    .map((row) =>
      result(
        `setting:${row.key}`,
        row.title,
        [`${tr("title")} › ${tr(row.section)}`, row.group].filter(Boolean).join(" · "),
        row.section,
        row.key,
      ),
    );
  return [...sections, ...rows].slice(0, Math.max(1, Math.min(limit, 50)));
}

/** Bring the row of setting `key` into sight in `within` and give its control the focus. */
export function revealRow(within: ParentNode, key: string): boolean {
  const control = within.querySelector<HTMLElement>(`[data-key="setting-${CSS.escape(key)}"]`);
  if (!control) return false;
  const row = control.closest<HTMLElement>(".settings-row") ?? control;
  for (const other of within.querySelectorAll(".settings-row.found"))
    other.classList.remove("found");
  row.classList.add("found");
  row.scrollIntoView({ block: "center" });
  control.focus({ preventScroll: true });
  return true;
}
