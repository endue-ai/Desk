/**
 * The desk's own updates on the shell (ADR 0054). The core's update.* (the runtime holds
 * update:manage) drives one row in the rail's attention list: the download's progress, then "Desk
 * 0.2.0 is ready" with Restart to update. The person hears once per staged version, across
 * restarts. The commands desk.update.check, .download, .apply and .notes reach the same calls; an
 * apply asked by anyone but the person (a plugin, an agent) waits for the person to say yes. A
 * build that does not update itself shows nothing and registers nothing.
 */
import {
  type BridgeClient,
  type BridgeEvent,
  messageText,
  type UpdateStatus,
} from "@endue-ai/bridge";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

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
  notify(input: {
    caller: string;
    title: string;
    body?: string;
    level?: "info" | "warning";
    actions?: Array<{ label: string; command: string }>;
  }): void;
  /** The version last announced, kept across restarts. */
  memory: { get(): string | null; set(version: string): void };
}

/** The words of updates, from the app's catalogs (messages/, ADR 0250), English for a missing one. */
const PREFIX = "desk.updates.";
type UpdateWord = keyof typeof en extends infer K
  ? K extends `desk.updates.${infer W}`
    ? W
    : never
  : never;
function wordsOf(lang: Lang): Record<UpdateWord, string> {
  const keys = Object.keys(en).filter((id) => id.startsWith(PREFIX));
  return Object.fromEntries(
    keys.map((id) => [id.slice(PREFIX.length), messageText({ en, ko }, lang, id)]),
  ) as Record<UpdateWord, string>;
}
const COPY: Record<Lang, Record<UpdateWord, string>> = { en: wordsOf("en"), ko: wordsOf("ko") };

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

/** About Desk: the running build, the channel it follows and a build waiting to install. */
export function aboutText(status: UpdateStatus, lang: Lang): { title: string; body: string } {
  const copy = COPY[lang];
  const { version, commit } = status.current;
  const title = fill(copy.about, { v: commit ? `${version} (${commit})` : version });
  const v = status.release?.version;
  const waiting = status.staged && v ? fill(copy.stagedAbout, { v }) : copy.upToDate;
  return { title, body: `${fill(copy.channel, { c: status.channel })} ${waiting}` };
}

export function installUpdates(host: UpdatesHost): () => void {
  const copy = COPY[host.lang];
  const offs: Array<() => void> = [];
  let active = true;
  let latest: UpdateStatus | undefined;
  /** The last refusal announced, so one reason is said once. */
  let refused: string | undefined;
  const call = (method: "update.status" | "update.check" | "update.download" | "update.apply") =>
    host.core.call(method, SCOPE);

  const show = (status: UpdateStatus) => {
    latest = status;
    host.show(rowFor(status, host.lang));
    const v = status.release?.version;
    if (status.state === "staged" && status.staged && v && host.memory.get() !== v) {
      host.memory.set(v);
      const title = fill(copy.ready, { v });
      // Later closes the notice; the rail keeps its row and the build stays staged.
      const actions = [
        { label: copy.restart, command: "desk.update.apply" },
        { label: copy.later, command: "desk.update.later" },
      ];
      host.notify({ caller: "desk", title, body: copy.readyBody, level: "info", actions });
    }
    // A build the desk refused (a bad signature or sha256) is said once, with why.
    const why = status.reason;
    if (status.state === "failed" && !status.staged && v && why && refused !== `${v} ${why}`) {
      refused = `${v} ${why}`;
      host.notify({
        caller: "desk",
        title: fill(copy.refused, { v }),
        body: why,
        level: "warning",
      });
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
    define("desk.update.later", "Install the Desk update later", async () => latest);
    define("desk.update.about", "About Desk", async () => {
      const shown = aboutText(latest ?? status, host.lang);
      host.notify({ caller: "desk", ...shown, level: "info" });
      return latest ?? status;
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
