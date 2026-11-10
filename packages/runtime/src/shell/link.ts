/**
 * The shell's state where the runtime keeps it: the profiles and the one in force (desk.profiles),
 * the moved desktops and Eris's mesh and soul text (settings), and the rest of the desk as it was
 * (desk.session, as the part "shell"). Desktops are kept as a list (ADR 0117): what a four-desktop
 * session saved, by desktop number, comes back on the four named 1 to 4. The plugin windows open
 * are kept too (#76), so they mount at the next start and come back on their slots. The window
 * manager reads and writes the desk's part of these records (crates/desk-wm, #83): the runtime
 * hands it what was kept and keeps what it publishes.
 */
import { baseMode, LAYOUTS, MODE, profileMode } from "../modes/profiles";
import type { Mode } from "../modes/types";
import type { Runtime } from "../runtime";
import { positionOf } from "../wm/view";
import { desktopId, desktopsOf, edit, movedValue, switched } from "./actions";
import type { ShellCtx } from "./context";
import type { DeskState } from "./state";
import { PLACE, placeOf, type TalkPlace } from "./talk-place";

const DENSITY = "desk.shell.density";
const SOUL = "desk.shell.soul";

/** The profiles as the shell lays them out, the base first. */
export function modesOf(runtime: Runtime): Mode[] {
  const base = baseMode(runtime.policy().settings[MODE]?.default);
  // Profiles that lay the desk out come first; the others (desk.profiles' own) lay out the base.
  const modes = runtime.profiles.list().map((profile) => profileMode(profile, base));
  return [base, ...modes.filter((m) => m.lays), ...modes.filter((m) => !m.lays)];
}

/**
 * What desk.shell.layouts keeps for the session: the desktops (the profile's own when the person
 * changed none) with the layouts moved on them, or nothing when nothing changed, as the window
 * manager writes it.
 */
export function layoutsOf(s: DeskState): DeskState["wm"]["moved"] | undefined {
  return s.wm.moved ?? undefined;
}

/** Keep the store in step with desk.profiles and the shell's settings, and the settings with the store. */
export function syncProfiles(ctx: ShellCtx): () => void {
  const { runtime, store } = ctx;
  const { settings } = runtime;
  const refresh = () =>
    void switched(ctx, modesOf(runtime), runtime.profiles.active() ?? store.get().modeId);
  const eris = () =>
    store.set((s) => ({
      eris: {
        ...s.eris,
        density: settings.get(DENSITY, s.eris.density),
        soul: settings.get(SOUL, s.eris.soul),
      },
    }));
  eris();
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const kept = () => settings.layer("session")[LAYOUTS];
  const offs = [
    runtime.profiles.onChange(refresh),
    settings.onChange((keys) => {
      if (keys.includes(MODE)) refresh();
      // Changed by someone else than the window manager's own write below: it takes the moves.
      if (keys.includes(LAYOUTS) && !same(kept() ?? null, layoutsOf(store.get()) ?? null)) {
        void edit(ctx, { op: "moved", value: movedValue(ctx) });
      }
      if (keys.includes(DENSITY) || keys.includes(SOUL)) eris();
    }),
    store.watch(
      (s) => layoutsOf(s),
      (value) => {
        if (same(value, kept())) return;
        if (value === undefined) settings.reset(LAYOUTS);
        else settings.set(LAYOUTS, value);
      },
    ),
  ];
  return () => {
    for (const off of offs) off();
  };
}

interface SavedShell {
  profile: string;
  /** desk.shell.layouts as it was: `{ desktops: [...] }`, or layouts by number before ADR 0117. */
  layouts: unknown;
  pan: DeskState["pan"];
  /** The desktop in front, by its position from 1, as before ADR 0117 (an id is read too). */
  desktop: string | number;
  drawer: DeskState["drawer"];
  spaceId: string;
  density?: string;
  soul?: string;
  /** Where the person moved the talk line (desk.shell.talk-place). */
  talkPlace?: TalkPlace;
  /** The canvas map is folded to its button; absent while it is open (shell/Minimap.ts). */
  mapFolded?: true;
  /**
   * The plugin windows open and not in the drawer, by surface id (#76): desk.session counts a part's
   * `shows`, so they mount at the next start instead of starting asleep (ADR 0070).
   */
  shows?: string[];
  /** Each one's slot and the pan it arrived at (`DeskState.adopted`), so it comes back there. */
  slots?: Record<string, Slot>;
}

type Slot = { slot: number; at?: { x: number; y: number } };

/** The plugin windows open and not put away in the drawer, with their slots. */
function openWindows(s: DeskState): Required<Pick<SavedShell, "shows" | "slots">> {
  const away = new Set(s.drawer.map((d) => d.placement?.plugin));
  const open = s.adopted.flatMap((a, i): [string, Slot][] =>
    away.has(a.id) ? [] : [[a.id, { slot: a.slot ?? i, ...(a.at ? { at: a.at } : {}) }]],
  );
  return { shows: open.map(([id]) => id), slots: Object.fromEntries(open) };
}

/** Keep the shell in the session record; `done` resolves once a restore has finished. */
export function keepShell(ctx: ShellCtx): { off(): void; done(): Promise<void> } {
  const { runtime, store } = ctx;
  const { settings } = runtime;
  let restoring = Promise.resolve();
  const off = runtime.keep("shell", {
    save: (): SavedShell => {
      const s = store.get();
      const layer = settings.layer("session");
      return {
        profile: s.modeId,
        layouts: layoutsOf(s) ?? {},
        pan: s.pan,
        desktop: positionOf(desktopsOf(s), desktopId(s)),
        drawer: s.drawer,
        spaceId: s.spaceId,
        ...(typeof layer[DENSITY] === "string" ? { density: layer[DENSITY] } : {}),
        ...(typeof layer[SOUL] === "string" ? { soul: layer[SOUL] } : {}),
        ...(placeOf(layer[PLACE]) ? { talkPlace: placeOf(layer[PLACE]) as TalkPlace } : {}),
        ...(s.mapFolded ? { mapFolded: true as const } : {}),
        ...openWindows(s),
      };
    },
    restore: (value) => {
      restoring = restore(ctx, value as Partial<SavedShell> | null);
    },
    onChange: (listener) => {
      const offs = [
        store.watch(
          (s) => [
            s.modeId,
            s.session,
            s.desktops,
            s.desktop,
            s.drawer,
            s.spaceId,
            s.pan,
            s.mapFolded,
            openWindows(s),
          ],
          listener,
        ),
        settings.onChange(
          (keys) => [DENSITY, SOUL, PLACE].some((key) => keys.includes(key)) && listener(),
        ),
      ];
      return () => {
        for (const undo of offs) undo();
      };
    },
  });
  return { off, done: () => restoring };
}

async function restore(ctx: ShellCtx, saved: Partial<SavedShell> | null): Promise<void> {
  if (!saved || typeof saved !== "object") return;
  const { runtime, store } = ctx;
  const { profile } = saved;
  if (
    profile &&
    profile !== store.get().modeId &&
    store.get().modes.some((m) => m.manifest.id === profile)
  ) {
    await runtime.commands.run("desk.profiles.switch", { id: profile }).catch(() => {});
  }
  const { layouts } = saved;
  if (layouts && typeof layouts === "object" && Object.keys(layouts).length) {
    runtime.settings.set(LAYOUTS, layouts);
  }
  if (typeof saved.density === "string") runtime.settings.set(DENSITY, saved.density);
  if (typeof saved.soul === "string") runtime.settings.set(SOUL, saved.soul);
  const talkPlace = placeOf(saved.talkPlace);
  if (talkPlace) runtime.settings.set(PLACE, talkPlace);
  store.set((s) => ({
    spaceId: typeof saved.spaceId === "string" ? saved.spaceId : s.spaceId,
    mapFolded: saved.mapFolded === true,
  }));
  // The desktop in front, the pans, the drawer and the windows' slots: the window manager reads
  // them as they were kept, a session dated by the clock (before wall-clock ages) dated now.
  await edit(ctx, {
    op: "restore",
    desktop: saved.desktop ?? null,
    pan: saved.pan ?? null,
    ...(Array.isArray(saved.drawer) ? { drawer: saved.drawer } : {}),
    slots: saved.slots ?? null,
    now: Math.round(ctx.wall()),
  });
}
