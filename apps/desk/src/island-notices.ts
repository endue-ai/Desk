// Notices on the island (ADR 0204): what callers ask the desk to say (`ui.notified`), under
// desk.notify's rules as the desk's status line follows them, with the runtime's own Notifications:
// how long each level shows, do-not-disturb holding back the levels it does not allow, and a line
// for what it held once it ends. The island hears them only while it shows; with the desk in front
// (the island hidden, ADR 0205) the desk's status line says them.
import type { BridgeEvent } from "@endue-ai/bridge";
import {
  type Clock,
  DEFAULT_NOTIFY,
  type Notice,
  Notifications,
  type NotifySettings,
} from "@endue-ai/runtime";

export interface IslandNotices {
  /** A core event: `ui.notified` becomes a notice, unless the page is hidden. */
  hear(event: BridgeEvent): void;
  /** desk.notify's rules, from the shell (`island_state`, `island://notify`). */
  configure(rules: unknown): void;
  /** The notice showing now. */
  current(): Notice | null;
  /** The latest notices it showed (not held back), newest first. */
  recent(): Notice[];
  /** The person opened the island: the notice showing has been seen. */
  seen(): void;
  dispose(): void;
}

/** How many notices the open island lists. */
const RECENT = 3;

/** desk.notify's rules as the shell sends them, each the default when it is not well formed. */
export function rulesOf(rules: unknown): NotifySettings {
  const given = (rules ?? {}) as Partial<NotifySettings>;
  const durations = { ...DEFAULT_NOTIFY.durations };
  for (const level of Object.keys(durations) as Array<keyof typeof durations>) {
    const ms = given.durations?.[level];
    if (typeof ms === "number" && ms >= 0) durations[level] = ms;
  }
  return {
    durations,
    dnd: typeof given.dnd === "boolean" ? given.dnd : DEFAULT_NOTIFY.dnd,
    dndAllows: Array.isArray(given.dndAllows) ? given.dndAllows : DEFAULT_NOTIFY.dndAllows,
    history: typeof given.history === "number" ? given.history : DEFAULT_NOTIFY.history,
  };
}

export function islandNotices(
  clock: Clock,
  hidden: () => boolean,
  changed: () => void,
): IslandNotices {
  const notifications = new Notifications(clock, () => changed());
  return {
    hear(event) {
      if (event.event !== "ui.notified" || hidden()) return;
      const { notificationId, caller, title, body, level } = event.data;
      notifications.push({ id: notificationId, caller, title, level, ...(body ? { body } : {}) });
    },
    configure(rules) {
      notifications.configure(rulesOf(rules));
      changed();
    },
    current: () => notifications.current(),
    recent: () =>
      notifications
        .history()
        .filter((notice) => !notice.held)
        .slice(0, RECENT),
    seen: () => notifications.dismiss(),
    dispose: () => notifications.dispose(),
  };
}
