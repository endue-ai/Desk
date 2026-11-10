// The shell this page runs in: the CEF shell, which puts `__deskNative` in the page (#43, ADR 0143).
// It answers the page's commands (`bridge_call`, `desk_ready`, …) and sends the core's events as
// `bridge://event`, so the rest of the app calls `invoke` and `listen` from here.
import {
  type BridgeAdapter,
  type CefHost,
  cefAdapter,
  cefHost,
  deskNative,
} from "@endue-ai/bridge";

type Invoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = <T = unknown>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

/** Why a call fails in a page without the shell (a plain browser, a test). */
export const NO_SHELL = "the desk's page runs only in the desk's shell: it has no __deskNative";

/** The shell's side, or one that refuses every command and sends no event. */
function shellHost(): CefHost {
  const native = deskNative();
  if (native) return cefHost(native);
  return {
    invoke: (command) => Promise.reject(new Error(`${command}: ${NO_SHELL}`)),
    listen: () => Promise.resolve(() => {}),
  };
}

const host = shellHost();

/** Call one of the shell's commands. */
export const invoke: Invoke = (command, args) => host.invoke(command, args ?? {}) as Promise<never>;

/** Hear one of the shell's events. */
export const listen: Listen = (event, handler) =>
  host.listen(event, handler as (event: { payload: unknown }) => void);

/** The bridge adapter of the shell: `cef` in the status line. */
export function adapter(): BridgeAdapter {
  return cefAdapter(host);
}
