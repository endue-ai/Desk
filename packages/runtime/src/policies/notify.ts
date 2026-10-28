/**
 * desk.notify: the status line is the echo area. ui.notified events and the runtime's own notices
 * show there as the notify settings say, and every one goes to the history (*Messages*).
 */
import type { NotifyLevel } from "@endue-ai/bridge";
import {
  DEFAULT_NOTIFY,
  type Notice,
  type NoticeInput,
  Notifications,
  noticeText,
} from "../notify";
import { type DeskContext, disposer, type Installed } from "./context";

export interface NotifyPolicy extends Installed {
  notifications: Notifications;
  notify(input: NoticeInput): Notice;
  /** The line the status shows when no notice does ("desk ready ..."). */
  setBase(text: string): void;
  text(): string;
}

const LEVELS: NotifyLevel[] = ["info", "success", "warning", "error"];

export function installNotify(ctx: DeskContext, statusLine: HTMLElement): NotifyPolicy {
  const { hub, bridge, clock } = ctx;
  const { settings, commands } = hub;
  const offs = disposer();
  let base = statusLine.textContent ?? "";

  const render = (notice: Notice | null) => {
    statusLine.textContent = notice ? noticeText(notice) : base;
    if (notice) statusLine.dataset.level = notice.level;
    else delete statusLine.dataset.level;
  };
  const notifications = new Notifications(clock, render);
  offs.add(() => notifications.dispose());

  const configure = () =>
    notifications.configure({
      durations: Object.fromEntries(
        LEVELS.map((level) => [
          level,
          settings.get(`desk.notify.${level}-ms`, DEFAULT_NOTIFY.durations[level]),
        ]),
      ) as Record<NotifyLevel, number>,
      dnd: settings.get("desk.notify.dnd", DEFAULT_NOTIFY.dnd),
      dndAllows: settings.get("desk.notify.dnd-allows", DEFAULT_NOTIFY.dndAllows),
      history: settings.get("desk.notify.history", DEFAULT_NOTIFY.history),
    });
  configure();
  offs.add(
    settings.onChange((keys) => keys.some((k) => k.startsWith("desk.notify.")) && configure()),
  );

  offs.add(
    bridge.onEvent((event) => {
      if (event.event !== "ui.notified") return;
      const { notificationId, caller, title, body, level } = event.data;
      notifications.push({ id: notificationId, caller, title, level, ...(body ? { body } : {}) });
    }),
  );

  const define = (id: string, title: string, run: () => unknown, keywords: string[] = []) =>
    offs.add(
      commands.define(id, {
        title,
        keywords: ["notifications", ...keywords],
        owner: "desk.notify",
        run,
      }),
    );
  define("desk.notify.dismiss", "Dismiss the notification", () => notifications.dismiss());
  define(
    "desk.notify.dnd",
    "Turn do not disturb on or off",
    () => {
      const next = !notifications.settings.dnd;
      settings.set("desk.notify.dnd", next);
      return next;
    },
    ["do not disturb", "focus", "quiet"],
  );
  define(
    "desk.notify.history",
    "Show past notifications",
    async () => {
      const history = notifications.history();
      if (commands.has("desk.palette.pick")) {
        await commands
          .run("desk.palette.pick", {
            title: "Notifications",
            items: history.map((n) => ({ id: n.id, label: noticeText(n), detail: n.caller })),
          })
          .catch(() => {});
      }
      return history;
    },
    ["messages", "history"],
  );
  define("desk.notify.clear", "Clear past notifications", () => notifications.clear(), ["history"]);

  return {
    notifications,
    notify: (input) => notifications.push(input),
    setBase: (text) => {
      base = text;
      if (!notifications.current()) render(null);
    },
    text: () => statusLine.textContent ?? "",
    dispose: offs.dispose,
  };
}
