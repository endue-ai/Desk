// Compositor mode (#56): the compositor hears every key first and decides, before it delivers one
// to the surface with the focus, whether the desk's keymap takes it (ADR 0118). So this page tells
// the CEF shell the keymap's entries as the runtime applied them, every layer's, which the
// compositor resolves by the same precedence; the commands registered now, since a key whose command
// is off passes on; and how long a prefix waits. It says it again whenever one of them changes.

/** One binding of a layer as the runtime's keymap applied it (its `KeyEntry`), passed on whole. */
export interface KeyEntry {
  key: string;
  mac?: string;
  command: string;
  args?: unknown;
  owner: string;
  source?: unknown;
}

export interface KeysReport {
  platform: "mac" | "other";
  entries: KeyEntry[];
  known: string[];
  timeout: number;
}

export interface KeysSource {
  platform: "mac" | "other";
  keymap: { entries(): KeyEntry[]; onChange(listener: () => void): () => void };
  commands: { list(): Array<{ id: string }>; onChange(listener: () => void): () => void };
  settings: {
    get<T>(key: string, fallback: T): T;
    onChange(listener: (keys: string[]) => void): () => void;
  };
}

/** The setting that bounds a prefix's wait (packages/runtime/src/core/defaults.ts). */
export const SEQUENCE_TIMEOUT = "desk.keys.sequence-timeout";

/** What the compositor needs of the keymap now. */
export function keysReport(source: KeysSource): KeysReport {
  const ms = source.settings.get<unknown>(SEQUENCE_TIMEOUT, 0);
  const timeout =
    typeof ms === "number" && Number.isFinite(ms) ? Math.min(Math.max(ms, 0), 10000) : 0;
  return {
    platform: source.platform,
    entries: source.keymap.entries(),
    known: source.commands.list().map((command) => command.id),
    timeout,
  };
}

/** Report the keymap now and on every change, once per change; returns the function that stops. */
export function startCompositorKeys(
  source: KeysSource,
  send: (report: KeysReport) => void,
): () => void {
  let last = "";
  let queued = false;
  const tell = () => {
    queued = false;
    const report = keysReport(source);
    const text = JSON.stringify(report);
    if (text === last) return;
    last = text;
    send(report);
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(tell);
  };
  const offs = [
    source.keymap.onChange(schedule),
    source.commands.onChange(schedule),
    source.settings.onChange((keys) => keys.includes(SEQUENCE_TIMEOUT) && schedule()),
  ];
  schedule();
  return () => {
    for (const off of offs) off();
  };
}
