/** The composer doubles as a command palette: surfaces, modes, agents and settings, by keyword. */
import { openSurface, selectAgent, switchMode } from "./actions";
import type { ShellCtx } from "./context";
import type { CopyKey } from "./copy";
import type { DeskState } from "./state";

export interface Command {
  id: string;
  label: string;
  keywords: string[];
  run(): void;
}

const SURFACES: [string, CopyKey, string[]][] = [
  ["calendar", "surfaceCalendar", ["calendar", "캘린더", "일정"]],
  ["tomorrow", "surfaceTomorrow", ["tomorrow", "내일"]],
  ["notes", "surfaceNotes", ["notes", "memo", "메모"]],
];

export function commands(ctx: ShellCtx, s: DeskState): Command[] {
  const list: Command[] = [];
  for (const [id, key, words] of SURFACES) {
    const name = ctx.tr(key);
    list.push({
      id: `open-${id}`,
      label: ctx.tr("cmdOpen", { x: name }),
      keywords: [...words, name],
      run: () => openSurface(ctx, id),
    });
  }
  for (const m of s.modes) {
    if (m.manifest.id === "base") continue;
    list.push({
      id: `mode-${m.manifest.id}`,
      label: ctx.tr("cmdMode", { x: m.manifest.name }),
      keywords: [m.manifest.name, m.manifest.id],
      run: () => switchMode(ctx, m.manifest.id),
    });
  }
  for (const a of s.spaces.find((sp) => sp.id === s.spaceId)?.agents ?? []) {
    list.push({
      id: `agent-${a.id}`,
      label: ctx.tr("cmdAgent", { x: a.name }),
      keywords: [a.name],
      run: () => selectAgent(ctx, a.id),
    });
  }
  for (const theme of ["light", "dark"] as const) {
    list.push({
      id: `theme-${theme}`,
      label: ctx.tr("cmdTheme", { x: ctx.tr(theme) }),
      keywords: [theme, ctx.tr(theme), "theme", "테마", "settings", "설정"],
      run: () => ctx.store.set({ theme }),
    });
  }
  for (const soul of ["wisp", "solemn"] as const) {
    list.push({
      id: `soul-${soul}`,
      label: ctx.tr("cmdSoul", { x: soul }),
      keywords: [soul, "soul", "소울", "settings", "설정"],
      run: () => ctx.store.set((st) => ({ eris: { ...st.eris, soul } })),
    });
  }
  for (const density of ["airy", "balanced", "dense"] as const) {
    list.push({
      id: `density-${density}`,
      label: ctx.tr("cmdDensity", { x: density }),
      keywords: [density, "density", "mesh", "밀도", "settings", "설정"],
      run: () => ctx.store.set((st) => ({ eris: { ...st.eris, density } })),
    });
  }
  return list;
}

/** Commands whose keyword starts with, then contains, the query. At most six. */
export function match(list: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (c: Command) => {
    const words = c.keywords.map((k) => k.toLowerCase());
    if (words.some((w) => w.startsWith(q))) return 2;
    if (words.some((w) => w.includes(q))) return 1;
    return 0;
  };
  return list
    .map((c, i) => ({ c, i, s: score(c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 6)
    .map((x) => x.c);
}
