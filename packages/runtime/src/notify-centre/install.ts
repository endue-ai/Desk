/**
 * The notification centre (#307) beside a status line on a page: its control right after the line,
 * and the panel the control opens right after the control. Opening the panel reads every notice
 * (`markRead`), and what arrives while it is open is read there. A press outside it, Escape in it,
 * the control again or desk.notify.history closes it; Escape, or closing it while it held the focus,
 * gives the focus back to what had it before it opened, else to the control.
 */
import type { Notice, NoticeAction, Notifications } from "../notify";
import type { Installed } from "../policies/context";
import { createBell } from "./bell";
import { createPanel, type Panel, type PanelDeps } from "./centre";

export interface CentreDeps extends Omit<PanelDeps, "escape" | "open" | "act" | "dismiss"> {
  notifications: Notifications;
  /** Open what a notice is about (ADR 0113); the panel has closed first. */
  open(notice: Notice): Promise<unknown>;
  /** Run one of a notice's actions as a gesture: a failure says why. */
  act(notice: Notice, action: NoticeAction): Promise<unknown>;
}

export interface NotifyCentre extends Installed {
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
  /** Draw the control and the panel again: a setting or the language changed. */
  refresh(): void;
}

export function installCentre(line: HTMLElement, deps: CentreDeps): NotifyCentre {
  const doc = line.ownerDocument;
  const { notifications } = deps;
  let panel: Panel | null = null;
  /** What had the focus when the panel opened. */
  let before: HTMLElement | null = null;

  const bell = createBell(() => toggle());
  line.after(bell.element);

  const refresh = () => {
    // Open, it shows every notice: none is unread while it does (marking them comes back here).
    if (panel && notifications.unread() > 0) return notifications.markRead();
    panel?.render();
    bell.update(notifications.unread(), panel !== null, deps.language());
  };

  const outside = (event: Event) => {
    const target = event.target as Node | null;
    if (!panel || !target) return;
    if (panel.element.contains(target) || bell.element.contains(target)) return;
    close(false);
  };

  const open = () => {
    if (panel) return;
    const active = doc.activeElement as HTMLElement | null;
    before = active && active !== doc.body && typeof active.focus === "function" ? active : null;
    panel = createPanel({
      ...deps,
      open: (notice) => {
        close(false);
        void deps.open(notice);
      },
      act: (notice, action) => void deps.act(notice, action),
      dismiss: (notice) => notifications.remove(notice.id),
      escape: () => close(true),
    });
    bell.element.after(panel.element);
    doc.addEventListener("pointerdown", outside, true);
    refresh();
    panel.focusFirst();
  };

  /** Close it; give the focus back when asked, or when it held the focus. */
  function close(giveBack: boolean) {
    if (!panel) return;
    const held = panel.element.contains(doc.activeElement);
    panel.element.remove();
    panel = null;
    doc.removeEventListener("pointerdown", outside, true);
    refresh();
    if (giveBack || held) (before?.isConnected ? before : bell.element).focus();
    before = null;
  }

  function toggle() {
    if (panel) close(false);
    else open();
  }

  const offChange = notifications.onChange(refresh);
  refresh();
  return {
    isOpen: () => panel !== null,
    open,
    close: () => close(false),
    toggle,
    refresh,
    dispose: () => {
      offChange();
      close(false);
      bell.element.remove();
    },
  };
}
