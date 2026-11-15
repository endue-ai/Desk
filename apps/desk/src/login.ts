// Start at login (#237, ADR 0225). The shell registers the desk with the OS as `desk.login.start`
// says (`apps/desk/shell/src/login.rs`), and this page tells it what the setting is: once the desk
// is ready and each time it changes. The settings window keeps the person's choice in the runtime's
// store, which only this page reads.
import type { Desk } from "@endue-ai/runtime";

export const LOGIN_SETTING = "desk.login.start";

export interface LoginHost {
  settings: Pick<Desk["runtime"]["settings"], "get" | "onChange">;
  /** Tell the shell (`desk_login`). */
  tell(start: boolean): Promise<unknown>;
  report(error: unknown): void;
}

/** Tell the shell the setting now and whenever it changes; returns what stops it. */
export function followLogin(host: LoginHost): () => void {
  let told: boolean | undefined;
  const tell = () => {
    const start = host.settings.get<unknown>(LOGIN_SETTING, false) === true;
    if (start === told) return;
    told = start;
    host.tell(start).catch((error: unknown) => {
      // Not told: the next change, or the next start, says it again.
      told = undefined;
      host.report(error);
    });
  };
  tell();
  return host.settings.onChange((keys) => {
    if (keys.includes(LOGIN_SETTING)) tell();
  });
}
