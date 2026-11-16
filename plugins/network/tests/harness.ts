// Fakes for the plugin's tests: a runner that answers each program as the fixtures say (and records
// what it was asked), and a bridge for proc.*, net.*, perm.request, store.*, ui.notify and brain.ask.
import * as F from "./fixtures";

export type Outcome = { code: number | null; stdout: string };
export type Call = { program: string; args: string[] };

/** A runner over a function from program and args to what it prints. */
export function fakeRunner(answer: (program: string, args: string[]) => Outcome | string) {
  const calls: Call[] = [];
  return {
    calls,
    run: async (program: string, args: string[]) => {
      calls.push({ program, args });
      const out = answer(program, args);
      return typeof out === "string" ? { code: 0, stdout: out } : out;
    },
  };
}

/** The Mac of the fixtures: everything answers; the router pings 2 ms, the camera 140 ms. */
export function macRunner(overrides: Partial<Record<string, string>> = {}) {
  return fakeRunner((program, args) => {
    if (program in overrides) return overrides[program] ?? "";
    switch (program) {
      case "route":
        return F.ROUTE;
      case "ifconfig":
        return F.IFCONFIG;
      case "arp":
        return F.ARP;
      case "ping": {
        const ip = args[args.length - 1] ?? "";
        const ms: Record<string, number> = {
          "192.168.0.1": 2,
          "192.168.0.21": 35,
          "192.168.0.23": 140,
        };
        return ip in ms ? F.pingReply(ms[ip] ?? 0) : { code: 2, stdout: F.PING_NONE };
      }
      case "dig":
        return args[1] === "192.168.0.21" ? "raspberrypi.local.\n" : F.DIG_NONE;
      case "profiler":
        return F.WIFI;
      default:
        return { code: 1, stdout: "" };
    }
  });
}

type Handler = (params: any) => unknown;

/** A bridge with a store in memory; each method answers through `handlers`, else `unsupported`. */
export function fakeBridge(handlers: Record<string, Handler> = {}) {
  const store = new Map<string, unknown>();
  const calls: Array<{ method: string; params: any }> = [];
  const listeners = new Set<(event: { event: string; data: any }) => void>();
  const base: Record<string, Handler> = {
    "store.get": ({ key }) => (store.has(key) ? { value: structuredClone(store.get(key)) } : {}),
    "store.set": ({ key, value }) => {
      if (new TextEncoder().encode(JSON.stringify(value)).length > 64 * 1024)
        throw Object.assign(new Error("too big"), { code: "invalid_value" });
      store.set(key, structuredClone(value));
      return {};
    },
    "ui.notify": () => ({ id: "n-1" }),
  };
  return {
    store,
    calls,
    emit: (event: string, data: any) => {
      for (const l of listeners) l({ event, data });
    },
    onEvent: (listener: (event: { event: string; data: any }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    call: async (method: string, params: any) => {
      calls.push({ method, params });
      const handler = handlers[method] ?? base[method];
      if (!handler) throw Object.assign(new Error(method), { code: "unsupported" });
      return handler(params);
    },
  };
}

/** The English catalog as a `t`. */
export async function englishT() {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const catalog = JSON.parse(
    readFileSync(join(import.meta.dirname, "../messages/en.json"), "utf8"),
  ) as Record<string, string | Record<string, string>>;
  return (id: string, params: Record<string, unknown> = {}) => {
    const entry = catalog[id];
    const text =
      typeof entry === "string"
        ? entry
        : entry
          ? (entry[Number(params.count) === 1 ? "one" : "other"] ?? entry.other)
          : id;
    return (text ?? id).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
  };
}
