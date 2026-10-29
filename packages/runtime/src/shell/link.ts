/**
 * The shell's state where the runtime keeps it: the profiles and the one in force (desk.profiles),
 * the moved desktops and Eris's mesh and soul text (settings), and the rest of the desk as it was
 * (desk.session, as the part "shell").
 */
import { baseMode, LAYOUTS, MODE, profileMode } from "../modes/profiles";
import { DESKTOPS, type DesktopIndex, type Mode } from "../modes/types";
import type { Runtime } from "../runtime";
import { sessionOf, switched } from "./actions";
import type { ShellCtx } from "./context";
import type { DeskState } from "./state";

const DENSITY = "desk.shell.density";
const SOUL = "desk.shell.soul";

/** The profiles as the shell lays them out, the base first. */
export function modesOf(runtime: Runtime): Mode[] {
  const base = baseMode(runtime.policy().settings[MODE]?.default);
  // Profiles that lay the desk out come first; the others (desk.profiles' own) lay out the base.
  const modes = runtime.profiles.list().map((profile) => profileMode(profile, base));
  return [base, ...modes.filter((m) => m.lays), ...modes.filter((m) => !m.lays)];
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
  const offs = [
    runtime.profiles.onChange(refresh),
    settings.onChange((keys) => {
      if (keys.includes(MODE)) refresh();
      if (keys.includes(LAYOUTS) && !same(sessionOf(ctx), store.get().session)) {
        store.set({ session: sessionOf(ctx) });
      }
      if (keys.includes(DENSITY) || keys.includes(SOUL)) eris();
    }),
    store.watch(
      (s) => s.session,
      (session) => {
        if (same(session, sessionOf(ctx))) return;
        if (Object.keys(session).length === 0) settings.reset(LAYOUTS);
        else settings.set(LAYOUTS, session);
      },
    ),
  ];
  return () => {
    for (const off of offs) off();
  };
}

interface SavedShell {
  profile: string;
  layouts: DeskState["session"];
  desktop: DesktopIndex;
  drawer: DeskState["drawer"];
  spaceId: string;
  density?: string;
  soul?: string;
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
        layouts: s.session,
        desktop: s.desktop,
        drawer: s.drawer,
        spaceId: s.spaceId,
        ...(typeof layer[DENSITY] === "string" ? { density: layer[DENSITY] } : {}),
        ...(typeof layer[SOUL] === "string" ? { soul: layer[SOUL] } : {}),
      };
    },
    restore: (value) => {
      restoring = restore(ctx, value as Partial<SavedShell> | null);
    },
    onChange: (listener) => {
      const offs = [
        store.watch((s) => [s.modeId, s.session, s.desktop, s.drawer, s.spaceId], listener),
        settings.onChange((keys) => (keys.includes(DENSITY) || keys.includes(SOUL)) && listener()),
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
  if (saved.layouts && typeof saved.layouts === "object" && Object.keys(saved.layouts).length) {
    runtime.settings.set(LAYOUTS, saved.layouts);
  }
  if (typeof saved.density === "string") runtime.settings.set(DENSITY, saved.density);
  if (typeof saved.soul === "string") runtime.settings.set(SOUL, saved.soul);
  store.set((s) => ({
    desktop: DESKTOPS.includes(saved.desktop as DesktopIndex)
      ? (saved.desktop as DesktopIndex)
      : s.desktop,
    drawer: Array.isArray(saved.drawer) ? saved.drawer : s.drawer,
    spaceId: typeof saved.spaceId === "string" ? saved.spaceId : s.spaceId,
  }));
}
