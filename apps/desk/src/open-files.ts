import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface OpenFilesHost {
  ready: Promise<void>;
  commands: { run(id: string, args: { path: string }): Promise<unknown> };
  report(error: unknown): void;
}

/** Events only signal pending work. The host queue consumes each path in one serialized drain. */
export function installOpenedFiles(host: OpenFilesHost): () => void {
  let active = true;
  let ready = false;
  let requested = false;
  let draining = false;
  let unlisten: (() => void) | undefined;
  const report = (error: unknown) => {
    if (active) host.report(error);
  };
  const drain = async () => {
    if (!active || !ready || draining) return;
    draining = true;
    try {
      do {
        requested = false;
        const paths = await invoke<string[]>("take_open_files");
        for (const path of paths) {
          if (!active) return;
          try {
            await host.commands.run("desk.files.open", { path });
          } catch (error) {
            report(error);
          }
        }
      } while (active && requested);
    } catch (error) {
      report(error);
    } finally {
      draining = false;
      if (active && requested) void drain();
    }
  };
  const request = () => {
    if (!active) return;
    requested = true;
    void drain();
  };
  // Subscribe first: arrivals between startup and the initial invoke remain in the native queue.
  void listen("desk://open-files", request)
    .then(async (off) => {
      if (!active) return off();
      unlisten = off;
      await host.ready;
      ready = true;
      request();
    })
    .catch(report);
  return () => {
    active = false;
    unlisten?.();
    unlisten = undefined;
  };
}
