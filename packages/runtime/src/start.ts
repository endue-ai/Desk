/**
 * How this start went (ADR 0061): safe mode, the state files kept broken, and the UI plugins whose
 * frames keep failing to start. The host (the app) says what it found at start; the desk tells the
 * person with notices whose actions fix it: "Start normally", "Show in file manager", "Turn on again".
 */
import { reportFailure } from "./gesture";
import type { NoticeInput } from "./notify";
import type { DeskContext } from "./policies/context";
import { Quarantine } from "./quarantine";

/** A state file found unreadable at start: it started empty and was kept at `path`. */
export interface BrokenStateFile {
  name: string;
  path: string;
}

/** What the host found at start. */
export interface StartInfo {
  /** Present when this start runs only the desk's own policies. */
  safe?: { reason: "asked" | "crash-loop"; heldOff: string[] };
  broken: BrokenStateFile[];
  /** The data folder, where store.json is (for records in the store that could not be read). */
  dataDir?: string;
}

const reveal = (path: string) => ({
  label: "Show in file manager",
  command: "desk.files.reveal",
  args: { path },
});

/** The notices a start opens with: the crash loop it recovered from, and each broken file. */
export function startNotices(info: StartInfo): NoticeInput[] {
  const notices: NoticeInput[] = [];
  if (info.safe?.reason === "crash-loop") {
    const held = info.safe.heldOff;
    notices.push({
      caller: "desk",
      title: "The desk started in safe mode",
      body: `The last two starts did not finish. Off for this start: ${held.join(", ") || "no plugins"}.`,
      level: "warning",
      actions: [{ label: "Start normally", command: "desk.start.normally" }],
    });
  }
  for (const file of info.broken) {
    notices.push({
      caller: "desk",
      title: `${file.name} could not be read`,
      body: `The desk started without it and kept it as ${file.name}.broken.`,
      level: "warning",
      actions: [reveal(file.path)],
    });
  }
  return notices;
}

/** A record in store.json the desk could not read: it starts without it and keeps `<key>.broken`. */
export function brokenRecordNotice(key: string, dataDir?: string): NoticeInput {
  const what = key === "session" ? "The saved session" : `The record ${key}`;
  return {
    caller: "desk",
    title: `${what} could not be read`,
    body: `The desk started without it and kept it as ${key}.broken in store.json.`,
    level: "warning",
    ...(dataDir ? { actions: [reveal(`${dataDir}/store.json`)] } : {}),
  };
}

export interface StartDeps {
  info?: StartInfo | undefined;
  notify(input: NoticeInput): void;
  /** Start the desk again without safe mode (the app does; a page without it cannot). */
  relaunch?: (() => void | Promise<void>) | undefined;
  /** Save the session now, before the desk goes. */
  save(): Promise<void>;
}

export interface StartPolicy {
  /** A mounted frame reported its start: ready, or failed with why. */
  outcome(plugin: string, ok: boolean): void;
  /** A start step failed (listing plugins, the profile, the session): one error notice says why. */
  failed(error: unknown): void;
  dispose(): void;
}

export function installStart(ctx: DeskContext, deps: StartDeps): StartPolicy {
  const { hub, bridge } = ctx;
  const { commands } = hub;
  const offs: Array<() => void> = [];
  const quarantine = new Quarantine(
    {
      get: async (key) => ((await bridge.call("store.get", { key })) as { value?: unknown }).value,
      set: async (key, value) => void (await bridge.call("store.set", { key, value })),
    },
    () => new Date().toISOString(),
  );
  const define = (id: string, title: string, run: (args: unknown) => unknown) =>
    offs.push(commands.define(id, { title, owner: "desk", keywords: ["start"], run }));

  define("desk.files.reveal", "Show a file in the file manager", async (args) => {
    const path = (args as { path?: unknown } | undefined)?.path;
    if (typeof path !== "string") throw new Error("Name the file to show");
    const scope = { permission: "shell:open" as const, paths: [path] };
    await bridge.call("shell.open", { target: path, reveal: true, scope });
  });
  define("desk.start.normally", "Start normally, without safe mode", async () => {
    if (!deps.relaunch) throw new Error("This desk cannot start itself again");
    await deps.save();
    await deps.relaunch();
  });
  define("desk.plugins.turn-on-again", "Turn a quarantined plugin on again", async (args) => {
    const plugin = (args as { plugin?: unknown } | undefined)?.plugin;
    if (typeof plugin !== "string") throw new Error("Choose a plugin to turn on");
    await quarantine.release(plugin);
    await commands.run("desk.plugins.open", { plugin });
  });

  for (const notice of startNotices(deps.info ?? { broken: [] })) deps.notify(notice);

  // Once the plugins are listed: a new version lets its quarantine go.
  let pruned = false;
  offs.push(
    hub.onPolicy(() => {
      if (pruned || hub.plugins.length === 0) return;
      pruned = true;
      const installed = hub.plugins.map((p) => ({ id: p.id, version: p.manifest?.version }));
      void quarantine.prune(installed).catch(() => {});
    }),
  );
  // The person turned it on (here, in the Plugins list or with `desk plugin enable`).
  offs.push(
    bridge.onEvent((event) => {
      if (event.event === "plugin.changed" && event.data.change === "enabled")
        void quarantine.release(event.data.plugin).catch(() => {});
    }),
  );

  return {
    failed: (error) => reportFailure(deps.notify, "The desk did not finish starting", error),
    outcome(plugin, ok) {
      if (ok) {
        void quarantine.ready(plugin).catch(() => {});
        return;
      }
      const info = hub.plugins.find((p) => p.id === plugin);
      const version = info?.manifest?.version ?? "0.0.0";
      void quarantine.failed(plugin, version).then(
        (quarantined) => {
          if (!quarantined) return;
          ctx.unmount(plugin);
          deps.notify({
            caller: "desk",
            title: `${info?.manifest?.name ?? plugin} is off: it failed to start three times`,
            body: `${plugin} ${version} stays off until you turn it on or it is updated.`,
            level: "warning",
            actions: [
              { label: "Turn on again", command: "desk.plugins.turn-on-again", args: { plugin } },
            ],
          });
        },
        () => {},
      );
    },
    dispose: () => {
      for (const off of offs.splice(0).reverse()) off();
    },
  };
}
