/**
 * Every command the desk has, by id. The composer lists them as a palette and the keymap binds keys
 * to them, so a command reached by typing and one reached by a key are the same command.
 */

import { DESKTOPS } from "../modes/types";
import { setDesktop, switchMode } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import type { CopyKey } from "../shell/copy";
import { closePane, cyclePane, newWindow, openView, splitPane } from "../shell/windows";
import { selectAgent, spaceAgents } from "./agents";

export interface Command {
  id: string;
  label: string;
  keywords: string[];
  run(): void;
  /** Listed in the composer's palette (false for keys only, like Escape). */
  palette: boolean;
}

const VIEWS: [string, CopyKey, string[]][] = [
  ["calendar", "surfaceCalendar", ["calendar", "캘린더", "일정"]],
  ["tomorrow", "surfaceTomorrow", ["tomorrow", "내일"]],
  ["notes", "surfaceNotes", ["notes", "memo", "메모"]],
];

/** Close popovers, dialogs and the composer. */
export function dismiss(ctx: ShellCtx): void {
  ctx.store.set((s) => ({
    popover: null,
    dialog: null,
    composer: s.composer.open ? { open: false, text: "", selected: 0 } : s.composer,
  }));
}

export function deskCommands(ctx: ShellCtx): Command[] {
  const s = ctx.store.get();
  const list: Command[] = [];
  const add = (id: string, label: string, keywords: string[], run: () => void, palette = true) =>
    list.push({ id, label, keywords, run, palette });

  add(
    "composer.open",
    ctx.tr("cmdComposer"),
    [],
    () => document.getElementById("composer-input")?.focus(),
    false,
  );
  add("ui.dismiss", ctx.tr("cmdDismiss"), [], () => dismiss(ctx), false);
  add(
    "window.new",
    ctx.tr("cmdNewSurface"),
    ["new", "window", "surface", "새", "표면", "창"],
    () => void newWindow(ctx),
  );
  add("pane.splitRight", ctx.tr("cmdSplitRight"), ["split", "right", "나누기", "오른쪽"], () =>
    splitPane(ctx, "row"),
  );
  add("pane.splitDown", ctx.tr("cmdSplitDown"), ["split", "down", "나누기", "아래"], () =>
    splitPane(ctx, "column"),
  );
  add("pane.close", ctx.tr("cmdClosePane"), ["close", "pane", "닫기", "칸"], () => closePane(ctx));
  add("pane.next", ctx.tr("cmdNextPane"), ["next", "pane", "다음", "칸"], () => cyclePane(ctx, 1));
  add("pane.previous", ctx.tr("cmdPreviousPane"), ["previous", "pane", "이전", "칸"], () =>
    cyclePane(ctx, -1),
  );
  for (const d of DESKTOPS) {
    add(`desktop.${d}`, ctx.tr("cmdDesktop", { n: d }), ["desktop", "데스크톱", String(d)], () =>
      setDesktop(ctx, d),
    );
  }
  add(
    "keys.open",
    ctx.tr("cmdKeys"),
    ["keys", "shortcuts", "keybindings", "단축키", "설정", "settings"],
    () => openView(ctx, "keys"),
  );
  for (const [id, key, words] of VIEWS) {
    const name = ctx.tr(key);
    add(`open.${id}`, ctx.tr("cmdOpen", { x: name }), [...words, name], () => openView(ctx, id));
  }
  for (const m of s.modes) {
    if (m.manifest.id === "base") continue;
    add(
      `mode.${m.manifest.id}`,
      ctx.tr("cmdMode", { x: m.manifest.name }),
      [m.manifest.name, m.manifest.id],
      () => switchMode(ctx, m.manifest.id),
    );
  }
  for (const a of spaceAgents(s)) {
    add(`agent.${a.slug}`, ctx.tr("cmdAgent", { x: a.name }), [a.name, a.slug], () =>
      selectAgent(ctx, a.id),
    );
  }
  for (const theme of ["light", "dark"] as const) {
    add(
      `theme.${theme}`,
      ctx.tr("cmdTheme", { x: ctx.tr(theme) }),
      [theme, ctx.tr(theme), "theme", "테마", "settings", "설정"],
      () => ctx.store.set({ theme }),
    );
  }
  for (const soul of ["wisp", "solemn"] as const) {
    add(
      `soul.${soul}`,
      ctx.tr("cmdSoul", { x: soul }),
      [soul, "soul", "소울", "settings", "설정"],
      () => ctx.store.set((st) => ({ eris: { ...st.eris, soul } })),
    );
  }
  for (const density of ["airy", "balanced", "dense"] as const) {
    add(
      `density.${density}`,
      ctx.tr("cmdDensity", { x: density }),
      [density, "density", "mesh", "밀도", "settings", "설정"],
      () => ctx.store.set((st) => ({ eris: { ...st.eris, density } })),
    );
  }
  return list;
}

/** Run a command by id; false when there is no such command right now. */
export function runCommand(ctx: ShellCtx, id: string): boolean {
  const command = deskCommands(ctx).find((c) => c.id === id);
  command?.run();
  return command !== undefined;
}

/** Palette commands whose keyword starts with, then contains, the query. At most six. */
export function match(list: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (c: Command) => {
    const words = c.keywords.map((k) => k.toLowerCase());
    if (words.some((w) => w.startsWith(q))) return 2;
    if (words.some((w) => w.includes(q)) || c.label.toLowerCase().includes(q)) return 1;
    return 0;
  };
  return list
    .filter((c) => c.palette)
    .map((c, i) => ({ c, i, s: score(c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 6)
    .map((x) => x.c);
}
