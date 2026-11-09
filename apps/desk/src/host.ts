// The shell this page runs in: the CEF shell, which puts `__deskNative` in the page (#43, ADR 0143),
// or the Tauri shell. Both answer the same commands (`bridge_call`, `desk_ready`, …) and send core
// events as `bridge://event`, so the rest of the app calls `invoke` and `listen` from here.
import {
  type BridgeAdapter,
  cefAdapter,
  cefHost,
  deskNative,
  tauriAdapter,
} from "@endue-ai/bridge";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

type Invoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = <T = unknown>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

const native = deskNative();
const cef = native ? cefHost(native) : undefined;

/** Which shell hosts the page. */
export const shell: "cef" | "tauri" = cef ? "cef" : "tauri";

/** Call one of the shell's commands. */
export const invoke: Invoke = cef
  ? (command, args) => cef.invoke(command, args ?? {}) as Promise<never>
  : tauriInvoke;

/** Hear one of the shell's events. */
export const listen: Listen = cef
  ? (event, handler) => cef.listen(event, handler as (event: { payload: unknown }) => void)
  : tauriListen;

/** The bridge adapter of the shell: `cef` or `tauri` in the status line. */
export function adapter(): BridgeAdapter {
  return cef
    ? cefAdapter(cef)
    : tauriAdapter((command, args) => tauriInvoke(command, args), tauriListen);
}
