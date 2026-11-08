/**
 * A command the person ran with a gesture (a bound key, a notice's button, a shell button) says why
 * it failed, in the palette's words (plugins/palette/ui/main.js): anything but `cancelled` posts one
 * error notice, "<command> failed" with the reason, and is logged. `cancelled` is the person backing
 * out (a pick closed), so it says nothing.
 */
import { CommandError, type Commands } from "./commands";
import type { NoticeInput } from "./notify";

/** Where a failure is said: the desk's notices (desk.notify). */
export type Notify = (input: NoticeInput) => unknown;

/** What a gesture needs of the desk; the Runtime is one. */
export interface GestureDesk {
  readonly commands: Pick<Commands, "run" | "list">;
  notify: Notify;
}

/** Whether the person backed out: no failure to report. */
export function isCancelled(error: unknown): boolean {
  return error instanceof CommandError && error.code === "cancelled";
}

/**
 * One error notice titled `title` with the reason, and a log line; nothing for `cancelled`. The
 * command's `id`, when given, is taken off the front of the reason (Commands.run puts it there).
 */
export function reportFailure(notify: Notify, title: string, error: unknown, id?: string): void {
  if (isCancelled(error)) return;
  const message = error instanceof Error ? error.message : String(error);
  const reason = id && message.startsWith(`${id}: `) ? message.slice(id.length + 2) : message;
  console.error(id ? `desk: ${id} failed:` : `desk: ${title}:`, error);
  notify({ caller: "desk", title, body: reason, level: "error" });
}

/** Run `id` for the person: true once it answered, false once its failure was reported. */
export async function runGesture(desk: GestureDesk, id: string, args?: unknown): Promise<boolean> {
  try {
    await desk.commands.run(id, args);
    return true;
  } catch (error) {
    const name = desk.commands.list().find((command) => command.id === id)?.title ?? id;
    reportFailure(desk.notify, `${name} failed`, error, id);
    return false;
  }
}
