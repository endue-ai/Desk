/**
 * The desk's own updates on the shell (ADR 0054). The core's update.* (the runtime holds
 * update:manage) drives one row in the rail's attention list: the download's progress, then "Desk
 * 0.2.0 is ready" with Restart to update. The person hears once per staged version, across
 * restarts. The commands desk.update.check, .download, .apply and .notes reach the same calls; an
 * apply asked by anyone but the person (a plugin, an agent) waits for the person to say yes. A
 * build that does not update itself shows nothing and registers nothing.
 */
import type { BridgeClient, BridgeEvent, UpdateStatus } from "@endue-ai/bridge";

/** The attention row's id. */
export const ROW = "desk.update";
/** Where the last announced version is kept. */
export const NOTIFIED = "desk.update.notified";

const SCOPE = { scope: { permission: "update:manage" } } as const;

export type Lang = "ko" | "en";

export interface UpdateRow {
  id: string;
  text: string;
  action?: { label: string; command: string };
}

/** Who runs a command: another caller by id, or the person when absent. */
interface From {
  caller?: string;
}

export interface UpdatesHost {
  core: Pick<BridgeClient, "call" | "onEvent">;
  ready: Promise<void>;
  lang: Lang;
  /** Put this module's row in the rail's attention list, or take it out. */
  show(row: UpdateRow | null): void;
  commands: {
    define(
      id: string,
      spec: {
        title: string;
        keywords: string[];
        owner: string;
        run(args: unknown, from: From): unknown;
      },
    ): () => void;
    has(id: string): boolean;
    run(id: string, args?: unknown): Promise<unknown>;
  };
  notify(input: { caller: string; title: string; body?: string; level?: "info" }): void;
  /** The version last announced, kept across restarts. */
  memory: { get(): string | null; set(version: string): void };
}

const COPY = {
  en: {
    downloading: "Downloading Desk {v} · {p}%",
    available: "Desk {v} is available",
    download: "Download",
    ready: "Desk {v} is ready",
    restart: "Restart to update",
    applying: "Restarting into Desk {v}…",
    failed: "Desk {v} did not install: {r}",
    retry: "Try again",
    readyBody: "Restart to update when it suits you.",
    confirm: "{caller} asks to restart Desk into {v}",
    restartNow: "Restart now",
    notNow: "Not now",
  },
  ko: {
    downloading: "Desk {v} 받는 중 · {p}%",
    available: "Desk {v} 가 나왔습니다",
    download: "받기",
    ready: "Desk {v} 준비됨",
    restart: "다시 시작해 업데이트",
    applying: "Desk {v} 로 다시 시작하는 중…",
    failed: "Desk {v} 를 설치하지 못했습니다: {r}",
    retry: "다시 시도",
    readyBody: "편할 때 다시 시작하면 업데이트됩니다.",
    confirm: "{caller} 가 Desk 를 {v} 로 다시 시작하려 합니다",
    restartNow: "지금 다시 시작",
    notNow: "나중에",
  },
} as const;

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/gu, (_, key: string) => String(values[key] ?? ""));

/** The attention row for a status, or none. */
export function rowFor(status: UpdateStatus, lang: Lang): UpdateRow | null {
  const copy = COPY[lang];
  const v = status.release?.version;
  if (!v) return null;
  const apply = { command: "desk.update.apply" };
  switch (status.state) {
    case "downloading": {
      const p = status.total ? Math.floor(((status.received ?? 0) * 100) / status.total) : 0;
      return { id: ROW, text: fill(copy.downloading, { v, p }) };
    }
    case "available":
      return {
        id: ROW,
        text: fill(copy.available, { v }),
        action: { label: copy.download, command: "desk.update.download" },
      };
    case "applying":
      return { id: ROW, text: fill(copy.applying, { v }) };
    case "failed":
      return status.staged
        ? {
            id: ROW,
            text: fill(copy.failed, { v, r: status.reason ?? "" }),
            action: { label: copy.retry, ...apply },
          }
        : null;
    default:
      return status.staged
        ? { id: ROW, text: fill(copy.ready, { v }), action: { label: copy.restart, ...apply } }
        : null;
  }
}

export function installUpdates(host: UpdatesHost): () => void {
  const copy = COPY[host.lang];
  const offs: Array<() => void> = [];
  let active = true;
  let latest: UpdateStatus | undefined;
  const call = (method: "update.status" | "update.check" | "update.download" | "update.apply") =>
    host.core.call(method, SCOPE);

  const show = (status: UpdateStatus) => {
    latest = status;
    host.show(rowFor(status, host.lang));
    const v = status.release?.version;
    if (status.state === "staged" && status.staged && v && host.memory.get() !== v) {
      host.memory.set(v);
      const title = fill(copy.ready, { v });
      host.notify({ caller: "desk", title, body: copy.readyBody, level: "info" });
    }
  };

  /** The person says yes before another caller restarts the desk. */
  const confirmed = async (from: From) => {
    if (!from.caller) return true;
    if (!host.commands.has("desk.palette.pick")) return false;
    const v = latest?.release?.version ?? "";
    const choice = await host.commands
      .run("desk.palette.pick", {
        title: fill(copy.confirm, { caller: from.caller, v }),
        items: [
          { id: "restart", label: copy.restartNow },
          { id: "later", label: copy.notNow },
        ],
      })
      .catch(() => undefined);
    return choice === "restart";
  };

  const define = (id: string, title: string, run: (from: From) => Promise<unknown>) =>
    offs.push(
      host.commands.define(id, {
        title,
        keywords: ["update", "upgrade", "release", "restart"],
        owner: "desk",
        run: (_args, from) => run(from),
      }),
    );

  const start = async () => {
    await host.ready;
    const status = await call("update.status").catch(() => undefined);
    if (!active || !status) return;
    offs.push(
      host.core.onEvent((event: BridgeEvent) => {
        if (event.event === "update.changed") show(event.data);
      }),
    );
    define("desk.update.check", "Check for Desk updates", () => call("update.check"));
    define("desk.update.download", "Download the Desk update", () => call("update.download"));
    define("desk.update.apply", "Restart to update Desk", async (from) => {
      if (!(await confirmed(from))) throw new Error("The person did not agree to restart Desk");
      return call("update.apply");
    });
    define("desk.update.notes", "Show the Desk release notes", async () => {
      const target = latest?.release?.notes;
      if (!target) throw new Error("There are no release notes to show");
      return host.core.call("shell.open", {
        target,
        scope: { permission: "shell:open", schemes: ["https"] },
      });
    });
    show(status);
  };
  void start();

  return () => {
    active = false;
    for (const off of offs.splice(0)) off();
    host.show(null);
  };
}
