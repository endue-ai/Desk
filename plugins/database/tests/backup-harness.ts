// The plugin mounted for backup and restore (backup.test.ts): three PostgreSQL connections
// (warehouse, Shop on production, locked read-only), a scripted server (the bridge stub's sessions)
// that says its version and schemas, the dialogs, grants and files a backup and a restore touch, recorded, and the forms
// answered. `held` stands in for a pg_dump that writes only when told and ends when told, or on
// the signal named, for the log panel and Cancel.
import type { Connection } from "../ui/engines/common.js";
import { type Handlers, type Mounted, mount, SAVED } from "./harness";

export interface Seen {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const WAREHOUSE: Connection = {
  ...(SAVED[1] as Connection),
  id: "c-wh",
  name: "warehouse",
  database: "warehouse",
  ssl: "default",
  tag: "none",
};
const SHOP = SAVED[1] as Connection;
const LOCKED: Connection = { ...WAREHOUSE, id: "c-ro", name: "locked", readOnly: true };

/** A plain dump of pg_dump 17.6 and later, as the restore reads it. */
export const PLAIN = [
  "--",
  "-- PostgreSQL database dump",
  "--",
  "",
  "\\restrict K3y",
  "",
  "SET statement_timeout = 0;",
  "INSERT INTO public.orders VALUES (1, 'a');",
  "",
  "\\unrestrict K3y",
  "",
].join("\n");

type Answer = Record<string, unknown> | undefined;

export async function start(
  options: {
    settings?: Record<string, unknown>;
    server?: string;
    password?: string;
    handlers?: Handlers;
    format?: string;
    restore?: Answer;
    backup?: Answer;
    pick?: () => string;
  } = {},
) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const record =
    <T>(method: string, answer: (params: never) => T) =>
    (params: unknown) => {
      calls.push({ method, params });
      return answer(params as never);
    };
  const handlers: Handlers = {
    "dialog.save": record("dialog.save", (p: { suggestedName: string }) => ({
      cancelled: false,
      path: `~/Backups/${p.suggestedName}`,
    })),
    "dialog.open": record("dialog.open", () => ({
      cancelled: false,
      paths: ["~/Backups/warehouse.dump"],
    })),
    "fs.write": record("fs.write", (p: { content: string }) => ({
      bytesWritten: p.content.length,
    })),
    "fs.stat": record("fs.stat", (p: { path: string }) =>
      /\.(dump|sql|tar)$/u.test(p.path)
        ? { kind: "file", size: 48_213, readOnly: false }
        : { kind: "dir", readOnly: false },
    ),
    "fs.list": record("fs.list", () => ({
      entries: [
        { name: "toc.dat", kind: "file", size: 1_000_000 },
        { name: "3432.dat.gz", kind: "file", size: 572_864 },
      ],
    })),
    "fs.read": record("fs.read", (p: { offset?: number; length?: number }) => {
      const bytes = Buffer.from(PLAIN, "utf8");
      const from = p.offset ?? 0;
      const part = bytes.subarray(from, p.length === undefined ? undefined : from + p.length);
      return { content: part.toString("base64"), encoding: "base64", size: bytes.length };
    }),
    ...options.handlers,
  };
  const m = await mount({
    store: { connections: [WAREHOUSE, SHOP, LOCKED] },
    ...(options.settings ? { settings: options.settings } : {}),
    handlers,
    pick: options.pick ?? (() => "yes"),
    ...(options.password ? { password: options.password } : {}),
    script: (sql) => {
      if (/^SHOW server_version_num$/u.test(sql))
        return { rows: [["server_version_num"], [options.server ?? "170006"]] };
      if (/pg_namespace/u.test(sql)) return { rows: [["nspname"], ["public"], ["sales"]] };
      return { changes: 1 };
    },
    dialog: (type, model) => {
      const form = model as { options: Record<string, unknown> };
      if (type === "restore") return options.restore;
      if ("backup" in options) return options.backup;
      const format = options.format ?? form.options.format;
      return { ...form.options, format, scope: "schemas", schemas: ["sales"], noOwner: true };
    },
  });
  return { m, calls };
}

/** What the plugin asked for with perm.request, of one permission (the test host grants it). */
export const asked = (m: Mounted, permission: string) =>
  m.host.calls
    .filter((c) => c.method === "perm.request")
    .map((c) => c.params as { permission: { permission: string; paths?: string[] } })
    .filter((p) => p.permission.permission === permission);

/** A pg_dump or pg_restore that writes and ends only when told; the rest stays scripted. */
export function held(options: { endOn?: "int" | "kill" } = {}) {
  let m: Mounted | undefined;
  let n = 0;
  const waiting: Array<(procId: string) => void> = [];
  const started: string[] = [];
  const signals: string[] = [];
  const emit = (event: unknown) => m?.host.emit(event as never);
  const exit = (procId: string, code: number | null, signal?: string) =>
    emit({ event: "proc.exit", data: { procId, code, ...(signal ? { signal } : {}) } });
  const handlers: Handlers = {
    "proc.spawn": (params, caller) => {
      const name = params.command.split("/").at(-1) ?? "";
      const real = !/^pg_(dump|restore)$/u.test(name) || params.args?.[0] === "--version";
      if (real) {
        const inner = m?.clients.handlers["proc.spawn"];
        if (!inner) throw Object.assign(new Error("not yet"), { code: "not_found" });
        return inner(params, caller);
      }
      const procId = `held-${++n}`;
      const waiter = waiting.shift();
      if (waiter) setTimeout(() => waiter(procId), 0);
      else started.push(procId);
      return { procId, pid: 900 + n };
    },
    "proc.kill": (params) => {
      signals.push(params.signal ?? "term");
      if (params.signal === options.endOn)
        setTimeout(() => exit(params.procId, null, params.signal), 0);
      return {};
    },
  };
  return {
    handlers,
    signals,
    attach: (mounted: Mounted) => {
      m = mounted;
    },
    /** The next held program once it started. */
    next: async () => {
      const procId =
        started.shift() ?? (await new Promise<string>((resolve) => waiting.push(resolve)));
      await m?.settle();
      return procId;
    },
    say: (procId: string, text: string) =>
      emit({
        event: "proc.output",
        data: { procId, stream: "stderr", data: text, encoding: "utf8" },
      }),
    exit: (procId: string, code: number) => exit(procId, code),
    /** Past the panel's 150 ms between drawings. */
    wait: async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await m?.settle();
    },
  };
}
