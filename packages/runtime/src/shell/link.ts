/**
 * The shell's state where the runtime keeps it: the profiles and the one in force (desk.profiles),
 * the moved desktops and Eris's mesh and soul text (settings), and the rest of the desk as it was
 * (desk.session, as the part "shell"). Desktops are kept as a list (ADR 0117): what a four-desktop
 * session saved, by desktop number, comes back on the four named 1 to 4. The plugin windows open
 * are kept too (#76), so they mount at the next start and come back on their slots.
 */
import { readCurrent, readPan, writeMoved } from "../desktops/migrate";
import { positionOf } from "../desktops/model";
import { baseMode, LAYOUTS, MODE, profileMode } from "../modes/profiles";
import type { Mode } from "../modes/types";
import type { Runtime } from "../runtime";
import { freeSlot } from "../surface/tiling";
import { desktopId, desktopsOf, modeOf, movedOf, switched } from "./actions";
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
 * What desk.shell.layouts keeps for the store's session: the desktops (the profile's own when the
 * person changed none) with the layouts moved on them, or nothing when nothing changed.
 */
export function layoutsOf(s: DeskState): ReturnType<typeof writeMoved> | undefined {
  if (s.desktops === null && Object.keys(s.session).length === 0) return undefined;
  return writeMoved(desktopsOf(s), s.session);
}

/** Keep the store in step with desk.profiles and the shell's settings, and the settings with the store. */
export function syncProfiles(ctx: ShellCtx): () => void {
  const { runtime, store } = ctx;
  const { settings } = runtime;
  const refresh = () =>
    switched(ctx, modesOf(runtime), runtime.profiles.active() ?? store.get().modeId);
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
      if (keys.includes(LAYOUTS)) {
        const moved = movedOf(ctx);
        const s = store.get();
        if (!same(moved, { session: s.session, desktops: s.desktops })) {
          const list = moved.desktops ?? modeOf(s).list;
          const here = desktopId({ ...s, ...moved });
          store.set({ ...moved, desktop: list.some((d) => d.id === here) ? here : s.desktop });
        }
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
  store.set((s) => {
    const list = desktopsOf(s);
    const pan = readPan(saved.pan);
    return {
      desktop: readCurrent(saved.desktop, list) ?? s.desktop,
      pan: Object.fromEntries(list.flatMap((d) => (pan[d.id] ? [[d.id, pan[d.id]]] : []))),
      // Items a session saved with clock times (before wall-clock ages) are dated now.
      drawer: Array.isArray(saved.drawer)
        ? saved.drawer.map((d) => (d.at < 1e12 ? { ...d, at: ctx.wall() } : d))
        : s.drawer,
      spaceId: typeof saved.spaceId === "string" ? saved.spaceId : s.spaceId,
      mapFolded: saved.mapFolded === true,
      adopted: slotted(s.adopted, slotsOf(saved.slots)),
    };
  });
}

/** The saved slots that can be read: a whole slot from 0, and a pan of two numbers if any. */
function slotsOf(value: unknown): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  if (typeof value !== "object" || value === null) return slots;
  for (const [id, saved] of Object.entries(value)) {
    const { slot, at } = (saved ?? {}) as Partial<Slot>;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0) continue;
    const pan = at && Number.isFinite(at.x) && Number.isFinite(at.y);
    slots.set(id, { slot, ...(pan ? { at: { x: at.x, y: at.y } } : {}) });
  }
  return slots;
}

/**
 * The windows back on the slot and at the pan they had (#76): at start the plugins mount in their
 * own order, each on the first slot left free. A window the save did not hold keeps its slot, or
 * takes a free one when a window that came back had it.
 */
function slotted(adopted: DeskState["adopted"], slots: Map<string, Slot>): DeskState["adopted"] {
  if (slots.size === 0) return adopted;
  const taken = new Set(adopted.flatMap((a) => slots.get(a.id)?.slot ?? []));
  return adopted.map((a, i) => {
    const kept = slots.get(a.id);
    if (kept) {
      const { at: _arrived, ...rest } = a;
      return { ...rest, ...kept };
    }
    const slot = a.slot ?? i;
    const free = taken.has(slot) ? freeSlot(taken) : slot;
    taken.add(free);
    return free === slot ? a : { ...a, slot: free };
  });
}
