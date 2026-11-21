// A desk notice in the OS's notifications while endue is out of sight (#306, ADR 0240). This page
// decides which notices go: every one that shows (do not disturb's held ones never do), as
// desk.notify.system says, with its title, body and first action. The shell checks whether the
// desk is in front and asks the OS. A click on the OS notification comes back as `notice://activated` and runs the
// notice's action or opens it.
import type { Desk, Notice } from "@endue-ai/runtime";

export const SYSTEM_SETTING = "desk.notify.system";
export type SystemWhen = "background" | "always" | "never";

/** What `desk_notice_post` carries. */
export interface SystemPost {
  id: string;
  title: string;
  body?: string;
  level: Notice["level"];
  action?: string;
  when: "background" | "always";
}

export interface SystemNoticesHost {
  settings: Pick<Desk["runtime"]["settings"], "get">;
  notices: Desk["runtime"]["notices"];
  /** Tell the shell (`desk_notice_post`). */
  post(post: SystemPost): Promise<unknown>;
  /** The shell's `notice://activated`; resolves to what stops it. */
  listen(handler: (payload: unknown) => void): Promise<() => void>;
  report(error: unknown): void;
}

/** desk.notify.system as set; anything else is the default. */
export function systemWhen(value: unknown): SystemWhen {
  return value === "always" || value === "never" ? value : "background";
}

/** What the shell is sent for `notice`, or nothing when the setting is `never`. */
export function systemPost(notice: Notice, when: SystemWhen): SystemPost | null {
  if (when === "never" || notice.held) return null;
  const action = notice.actions?.[0]?.label;
  return {
    id: notice.id,
    title: notice.title,
    ...(notice.body ? { body: notice.body } : {}),
    level: notice.level,
    ...(action ? { action } : {}),
    when,
  };
}

/** Send each notice that shows to the shell, and act on its clicks; returns what stops it. */
export function followSystemNotices(host: SystemNoticesHost): () => void {
  const offShown = host.notices.onShown((notice) => {
    const when = systemWhen(host.settings.get<unknown>(SYSTEM_SETTING, "background"));
    const post = systemPost(notice, when);
    if (post) host.post(post).catch((error: unknown) => host.report(error));
  });
  const listening = host.listen((payload) => {
    const { id, action } = (payload ?? {}) as { id?: unknown; action?: unknown };
    if (typeof id !== "string") return;
    host.notices.activate(id, action === true).catch((error: unknown) => host.report(error));
  });
  return () => {
    offShown();
    void listening.then((off) => off()).catch(() => {});
  };
}
