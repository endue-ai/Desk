/**
 * desk.notify: the status line is the echo area. ui.notified events and the runtime's own notices
 * show there as the notify settings say, and every one goes to the history (*Messages*). A notice's
 * actions are buttons beside its text: each runs its desk command and dismisses the notice, and one
 * that fails says why in a notice of its own (gesture.ts). A notice that stays until it is dismissed
 * (an error, one with actions) has a Dismiss button after them (#158). A running plugin's notice
 * opens what it is about (ADR 0113): a click on its text, or picking it in the history, shows the
 * plugin (desk.display.show) and then hands it the notice (desk.notify.open).
 */
import type { NotifyLevel } from "@endue-ai/bridge";
import { type GestureDesk, runGesture } from "../gesture";
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
  // A notice's button whose command fails says why, in a notice where that one was.
  const desk: GestureDesk = { commands, notify: (input) => notifications.push(input) };

  /** Whether a notice has a plugin to open: one that sent it and is running. */
  const opens = (notice: Notice) => notice.caller !== "desk" && ctx.mounted(notice.caller);
  const open = async (notice: Notice) => {
    if (!opens(notice)) return;
    if (commands.has("desk.display.show"))
      await runGesture(desk, "desk.display.show", { plugin: notice.caller });
    // The plugin's to answer, or not (a plugin that has no handler answers unknown_command).
    await ctx
      .request(notice.caller, "desk.notify.open", { notificationId: notice.id })
      .catch(() => {});
  };

  /** A button on the status line: a click dismisses its notice, then runs; `run` never rejects. */
  const button = (
    notice: Notice,
    label: string,
    className: string,
    run: () => Promise<unknown>,
  ) => {
    const element = statusLine.ownerDocument.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = label;
    element.addEventListener("click", () => {
      if (notifications.current() === notice) notifications.dismiss();
      void run();
    });
    return element;
  };

  const render = (notice: Notice | null) => {
    statusLine.textContent = notice ? noticeText(notice) : base;
    if (notice) statusLine.dataset.level = notice.level;
    else delete statusLine.dataset.level;
    const actions = notice?.actions ?? [];
    // A running plugin's notice is itself a button that opens what it is about (ADR 0113).
    const opener = notice !== null && opens(notice);
    // One that stays until it is dismissed (an error, or one with actions) can be (#158).
    const stays = notice !== null && notifications.stays(notice);
    statusLine.classList.toggle("has-actions", actions.length > 0 || opener || stays);
    if (!notice || (actions.length === 0 && !opener && !stays)) return;
    const said = noticeText(notice);
    // The text gives way (ellipsis, the whole of it on hover) so the buttons always show.
    const text = opener
      ? button(notice, said, "desk-status-text desk-status-open", () => open(notice))
      : statusLine.ownerDocument.createElement("span");
    if (!opener) {
      text.className = "desk-status-text";
      text.textContent = said;
    }
    text.title = said;
    statusLine.replaceChildren(text);
    for (const action of actions) {
      statusLine.append(
        button(notice, action.label, "desk-status-action", () =>
          runGesture(desk, action.command, action.args),
        ),
      );
    }
    if (stays) {
      // Its glyph is the stylesheet's, so the line's text stays the notice's own.
      const dismiss = button(notice, "", "desk-status-dismiss", async () => {});
      dismiss.title = "Dismiss";
      dismiss.setAttribute("aria-label", "Dismiss");
      statusLine.append(dismiss);
    }
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

  const define = (
    id: string,
    title: string,
    run: (args: unknown) => unknown,
    keywords: string[] = [],
  ) =>
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
    (args) => {
      const history = notifications.history();
      // The palette shows them (when it is on); the answer does not wait for the person.
      const show = (args as { show?: boolean } | undefined)?.show !== false;
      if (show && commands.has("desk.palette.pick")) {
        const items = history.map((n) => ({ id: n.id, label: noticeText(n), detail: n.caller }));
        void commands
          .run("desk.palette.pick", { title: "Notifications", items })
          .then((picked) => {
            const notice = history.find((n) => n.id === picked);
            return notice ? open(notice) : undefined;
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
    // The base line, not the notice over it: desk_ready and the smoke test read "desk ready".
    text: () => base,
    dispose: offs.dispose,
  };
}
