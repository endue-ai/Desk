/**
 * The shell's commands, in the runtime's one registry (ADR 0017): keys, the composer and plugins
 * all run these ids. Pane commands belong to desk.display; desktops, views, profiles, agents and
 * Eris's settings to desk.shell. Profiles and agents come and go, so their commands follow them.
 */
import type { CommandInfo } from "../commands";
import { DESKTOPS } from "../modes/types";
import { selectAgent, spaceAgents } from "../system/agents";
import { setDesktop } from "./actions";
import type { ShellCtx } from "./context";
import type { CopyKey } from "./copy";
import { closePane, newWindow, openView, splitPane } from "./windows";

const VIEWS: [string, CopyKey, string[]][] = [
  ["calendar", "surfaceCalendar", ["calendar", "캘린더", "일정"]],
  ["tomorrow", "surfaceTomorrow", ["tomorrow", "내일"]],
  ["notes", "surfaceNotes", ["notes", "memo", "메모"]],
];

/** A command id segment from a profile id or an agent slug (`my_desk.v2` → `my-desk-v2`). */
export const segment = (id: string) => id.toLowerCase().replace(/[^a-z0-9-]+/g, "-");

/** Close popovers, dialogs and the composer: what desk.keys.quit means in the shell. */
export function dismiss(ctx: ShellCtx): void {
  ctx.store.set((s) => ({
    popover: null,
    dialog: null,
    composer: s.composer.open ? { open: false, text: "", selected: 0 } : s.composer,
  }));
}

export function defineCommands(ctx: ShellCtx): () => void {
  const { commands, settings } = ctx.runtime;
  const fixed: Array<() => void> = [];
  const define = (
    id: string,
    owner: string,
    title: string,
    keywords: string[],
    run: () => unknown,
    into = fixed,
  ) =>
    into.push(
      commands.define(id, {
        title,
        keywords,
        owner,
        run: async () => {
          await run();
        },
      }),
    );
  const shell = (id: string, title: string, keywords: string[], run: () => unknown, into = fixed) =>
    define(`desk.shell.${id}`, "desk.shell", title, keywords, run, into);
  const display = (id: string, title: string, keywords: string[], run: () => unknown) =>
    define(`desk.display.${id}`, "desk.display", title, keywords, run);

  display(
    "new-surface",
    ctx.tr("cmdNewSurface"),
    ["new", "window", "surface", "새", "표면", "창"],
    () => newWindow(ctx),
  );
  display("split-right", ctx.tr("cmdSplitRight"), ["split", "right", "나누기", "오른쪽"], () =>
    splitPane(ctx, "row"),
  );
  display("split-down", ctx.tr("cmdSplitDown"), ["split", "down", "나누기", "아래"], () =>
    splitPane(ctx, "column"),
  );
  display("close-pane", ctx.tr("cmdClosePane"), ["close", "pane", "닫기", "칸"], () =>
    closePane(ctx),
  );
  for (const d of DESKTOPS) {
    shell(`desktop-${d}`, ctx.tr("cmdDesktop", { n: d }), ["desktop", "데스크톱", String(d)], () =>
      setDesktop(ctx, d),
    );
  }
  shell(
    "open-keys",
    ctx.tr("cmdKeys"),
    ["keys", "shortcuts", "keybindings", "단축키", "설정", "settings"],
    () => openView(ctx, "keys"),
  );
  for (const [id, key, words] of VIEWS) {
    const name = ctx.tr(key);
    shell(`open-${id}`, ctx.tr("cmdOpen", { x: name }), [...words, name], () => openView(ctx, id));
  }
  for (const soul of ["wisp", "solemn"] as const) {
    shell(`soul-${soul}`, ctx.tr("cmdSoul", { x: soul }), [soul, "soul", "소울", "설정"], () =>
      settings.set("desk.shell.soul", soul),
    );
  }
  for (const density of ["airy", "balanced", "dense"] as const) {
    shell(
      `density-${density}`,
      ctx.tr("cmdDensity", { x: density }),
      [density, "density", "mesh", "밀도", "설정"],
      () => settings.set("desk.shell.density", density),
    );
  }

  // Profiles and agents: defined again whenever the lists change.
  const dynamic: Array<() => void> = [];
  const redefine = () => {
    for (const off of dynamic.splice(0)) off();
    const s = ctx.store.get();
    for (const m of s.modes) {
      if (m.manifest.id === "base") continue;
      const id = m.manifest.id;
      shell(
        `profile-${segment(id)}`,
        ctx.tr("cmdMode", { x: m.manifest.name }),
        [m.manifest.name, id],
        () => commands.run("desk.profiles.switch", { id }),
        dynamic,
      );
    }
    for (const a of spaceAgents(s)) {
      shell(
        `agent-${segment(a.slug)}`,
        ctx.tr("cmdAgent", { x: a.name }),
        [a.name, a.slug],
        () => selectAgent(ctx, a.id),
        dynamic,
      );
    }
  };
  redefine();
  const off = ctx.store.watch(
    (s) => [s.modes.map((m) => [m.manifest.id, m.manifest.name]), spaceAgents(s).map((a) => a.id)],
    redefine,
  );
  return () => {
    off();
    for (const undo of [...fixed, ...dynamic]) undo();
  };
}

/** Commands whose keyword starts with, then contains, the query; else whose title has it. At most six. */
export function match(list: CommandInfo[], query: string): CommandInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (c: CommandInfo) => {
    const words = c.keywords.map((k) => k.toLowerCase());
    if (words.some((w) => w.startsWith(q))) return 2;
    if (words.some((w) => w.includes(q)) || c.title.toLowerCase().includes(q)) return 1;
    return 0;
  };
  return list
    .map((c, i) => ({ c, i, s: score(c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 6)
    .map((x) => x.c);
}
