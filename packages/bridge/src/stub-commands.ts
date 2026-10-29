/**
 * The core for the browser stub, so the runtime and plugins can be tested without it: the command
 * registry (cmd.*, ADR 0017), grants and prompts (perm.*), settings, the log, subscriptions (events.*)
 * and surfaces (ui.surface.*), per caller, with the core's rules (specs/bridge/v0/README.md). A plugin
 * caller's scoped call needs a covering grant; the runtime (`desk`) is trusted. cmd.list and cmd.invoke
 * check no grants. `audience` names the plugins the core would deliver an event to.
 */
import { StubError, type StubHandlers } from "./adapters";
import type {
  BridgeEvent,
  CallerGrant,
  CallerId,
  CommandFailure,
  CommandInfo,
  EventName,
  Grant,
  GrantChange,
  GrantDuration,
  LogEntry,
  Permission,
  PermPromptData,
  PermRequestResult,
  Setting,
  SurfacePlacement,
} from "./generated";

/** The methods the stub serves; any other is `unsupported` (adapters.ts). */
type Served =
  | `cmd.${"register" | "unregister" | "list" | "invoke" | "answer"}`
  | `perm.${"request" | "query" | "revoke" | "list" | "answer"}`
  | `settings.${"get" | "set" | "list"}`
  | `log.${"write" | "tail"}`
  | `events.${"subscribe" | "unsubscribe"}`
  | `ui.surface.${"open" | "close"}`;

export interface StubOptions {
  /** Grants each caller holds from the start, as `session` grants with ids g-<n>. */
  grants?: Record<CallerId, Permission[]>;
  /** Settings that exist from the start. */
  settings?: Setting[];
  /** The person's answer to perm.request when no caller holds perm:manage; granted by default. */
  prompt?: (data: PermPromptData) => boolean;
  /** The core's clock: log entries and grants are stamped with it. */
  now?: () => string;
}

export interface StubSurface {
  handle: string;
  caller: CallerId;
  surface: string;
  placement?: SurfacePlacement;
  title?: string;
}

/** What the stub holds, for tests: grants oldest first, settings by owner and key, the whole log. */
export interface StubState {
  grants: CallerGrant[];
  settings: Setting[];
  log: LogEntry[];
  surfaces: StubSurface[];
}

export interface StubCommands {
  handlers: Required<Pick<StubHandlers, Served>>;
  /** The caller providing a command, or undefined. */
  providerOf(id: string): string | undefined;
  /** The plugin callers the core would deliver an event to (never the runtime: it hears all). */
  audience(event: BridgeEvent): string[];
  /** A caller stopped: its commands go, what waits on it is cancelled, its surfaces close, its
   * subscriptions and prompts end. Its grants stay. */
  drop(caller: string): void;
  state(): StubState;
}

/** `*` matches any run of characters, dots included (or what `any` allows). */
function starMatch(pattern: string, text: string, any = ".*"): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(any);
  return new RegExp(`^${source}$`).test(text);
}

/** `owner/key` patterns: `*` stays within its part. */
const keyMatch = (pattern: string, text: string) => starMatch(pattern, text, "[^/]*");
/** Paths, hosts and programs: equal, under a trailing `*`, or under a leading `*.`. */
const within = (grant: string, asked: string) =>
  grant === asked ||
  (grant.endsWith("*") && asked.startsWith(grant.replace(/\*+$/, ""))) ||
  (grant.startsWith("*.") && asked.endsWith(grant.slice(1)));

const at = (permission: Permission, field: string) =>
  (permission as unknown as Record<string, unknown>)[field];

type Match = (pattern: string, text: string) => boolean;
/** The list each scoped permission carries, and how a granted pattern covers an asked one. */
const LISTS: Partial<Record<Permission["permission"], [string, Match]>> = {
  "cmd:invoke": ["ids", (p, t) => starMatch(p, t)],
  "settings:read": ["keys", keyMatch],
  "events:subscribe": ["names", (p, t) => p === t],
  "fs:read": ["paths", within],
  "fs:write": ["paths", within],
  "net:fetch": ["hosts", within],
  "proc:spawn": ["commands", within],
};

/** Whether `grant` covers everything `scope` asks for, as desk-core's `covers` judges it. */
function covers(grant: Permission, scope: Permission): boolean {
  const [field, match] = LISTS[scope.permission] ?? ["", () => true];
  const list = (p: Permission) => (at(p, field) ?? []) as string[];
  const flag = (name: string) => at(scope, name) !== true || at(grant, name) === true;
  const all = list(scope).every((text) => list(grant).some((pattern) => match(pattern, text)));
  return grant.permission === scope.permission && all && flag("pty") && flag("wakeWord");
}

const MANAGE: Permission = { permission: "perm:manage" };
const LOG: Permission = { permission: "log:read" };
const SURFACE: Permission = { permission: "ui:surface" };
const settingId = (owner: string, key: string) => `${owner}/${key}`;
type Prompt = { data: PermPromptData; decide(granted: boolean, duration?: GrantDuration): void };

/** `emit` delivers an event as the core would (the stub's `emit`); events leave after the answer. */
export function stubCommands(
  emit: (event: BridgeEvent) => void,
  options: StubOptions = {},
): StubCommands {
  const commands = new Map<string, CommandInfo>();
  const pending = new Map<string, { id: string; caller: string; provider: string }>();
  const grants: CallerGrant[] = [];
  const owners = new Map<string, string>();
  const prompts = new Map<string, Prompt>();
  const settings = new Map<string, Setting>();
  const log: LogEntry[] = [];
  const subscriptions = new Map<string, { caller: string; names: EventName[] }>();
  const surfaces = new Map<string, StubSurface>();
  const counts = new Map<string, number>();
  const fresh = (prefix: string) => {
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    return `${prefix}-${counts.get(prefix)}`;
  };
  const now = options.now ?? (() => new Date().toISOString());
  const later = (event: BridgeEvent) => queueMicrotask(() => emit(event));
  const me = (caller: string | undefined) => caller ?? "desk";
  const holds = (caller: string, permission: Permission) =>
    grants.find((g) => g.caller === caller && covers(g.grant.permission, permission));
  const holders = (permission: Permission) =>
    grants.filter((g) => covers(g.grant.permission, permission)).map((g) => g.caller);
  const subscribers = (name: EventName) =>
    [...subscriptions.values()].filter((s) => s.names.includes(name)).map((s) => s.caller);
  const sorted = () =>
    [...settings.values()].sort((a, b) => (`${a.owner}/${a.key}` < `${b.owner}/${b.key}` ? -1 : 1));
  const missing = (what: string) => new StubError("not_found", `${what} does not exist`);

  const changed = (grantId: string, change: GrantChange) =>
    later({ event: "perm.changed", data: { grantId, change } });
  const give = (caller: string, permission: Permission, duration: GrantDuration, quiet = false) => {
    const grant: Grant = { grantId: fresh("g"), permission, duration, grantedAt: now() };
    grants.push({ caller, grant });
    owners.set(grant.grantId, caller);
    if (!quiet) changed(grant.grantId, "granted");
    return grant;
  };
  const take = (grantId: string, change: GrantChange) => {
    const index = grants.findIndex((g) => g.grant.grantId === grantId);
    grants.splice(index, 1);
    changed(grantId, change);
  };
  /** A plugin caller's scoped call goes through when a grant covers the scope and the scope covers
   * what the call touches (`fits`); a `once` grant is used up. */
  const check = (caller: string | undefined, scope: Permission, fits = true) => {
    if (me(caller) === "desk") return;
    const held = fits ? holds(me(caller), scope) : undefined;
    const why = `${caller} holds no grant covering this ${scope.permission} scope`;
    if (!held) throw new StubError("permission_denied", why, scope);
    if (held.grant.duration === "once") take(held.grant.grantId, "expired");
  };

  const answered = (invocationId: string, result: unknown, error?: CommandFailure): void => {
    const invocation = pending.get(invocationId);
    if (!invocation) return;
    pending.delete(invocationId);
    const { id, caller } = invocation;
    const outcome = error ? { error } : result === undefined ? {} : { result };
    later({ event: "cmd.answered", data: { invocationId, id, caller, ok: !error, ...outcome } });
  };
  const remove = (id: string) => {
    const info = commands.get(id);
    if (!info) return;
    commands.delete(id);
    later({ event: "cmd.changed", data: { id, change: "unregistered", provider: info.provider } });
  };

  const audience = (event: BridgeEvent): string[] => {
    const to: Array<string | undefined> = [];
    if (event.event === "cmd.invoked")
      to.push(commands.get(event.data.id)?.provider, ...subscribers("cmd.invoked"));
    else if (event.event === "cmd.answered") to.push(event.data.caller);
    else if (event.event === "cmd.changed") to.push(...subscribers("cmd.changed"));
    else if (event.event === "perm.changed")
      to.push(owners.get(event.data.grantId), ...subscribers("perm.changed"));
    else if (event.event === "perm.prompt") to.push(...holders(MANAGE));
    else if (event.event === "plugin.changed")
      to.push(...holders({ permission: "plugin:manage" }), ...subscribers("plugin.changed"));
    else if (event.event === "settings.changed") {
      const keys = [settingId(event.data.owner, event.data.key)];
      const read = (c: string) => holds(c, { permission: "settings:read", keys });
      to.push(event.data.owner, ...subscribers("settings.changed").filter(read));
    } else if (event.event === "log.entry")
      to.push(...subscribers("log.entry").filter((c) => holds(c, LOG)));
    return [...new Set(to)].filter((c): c is string => c !== undefined && c !== "desk");
  };

  for (const [caller, permissions] of Object.entries(options.grants ?? {}))
    for (const permission of permissions) give(caller, permission, "session", true);
  for (const s of options.settings ?? []) settings.set(settingId(s.owner, s.key), { ...s });

  return {
    providerOf: (id) => commands.get(id)?.provider,
    audience,
    drop: (caller) => {
      for (const info of [...commands.values()]) if (info.provider === caller) remove(info.id);
      for (const [invocationId, invocation] of [...pending]) {
        if (invocation.provider !== caller) continue;
        const message = `${caller} stopped before it answered`;
        answered(invocationId, undefined, { code: "cancelled", message });
      }
      for (const [handle, s] of surfaces) if (s.caller === caller) surfaces.delete(handle);
      for (const [id, s] of subscriptions) if (s.caller === caller) subscriptions.delete(id);
      for (const prompt of [...prompts.values()])
        if (prompt.data.caller === caller) prompt.decide(false);
    },
    state: () =>
      structuredClone({ grants, settings: sorted(), log, surfaces: [...surfaces.values()] }),
    handlers: {
      "cmd.register": (params, caller) => {
        const provider = me(caller);
        const existing = commands.get(params.id);
        if (existing && existing.provider !== provider)
          throw new StubError("already_exists", `${params.id} is provided by ${existing.provider}`);
        commands.set(params.id, { ...params, provider });
        const change = existing ? "updated" : "registered";
        later({ event: "cmd.changed", data: { id: params.id, change, provider } });
        return {};
      },
      "cmd.unregister": ({ id }, caller) => {
        if (commands.get(id)?.provider !== me(caller))
          throw new StubError("not_found", `${me(caller)} provides no command ${id}`);
        remove(id);
        return {};
      },
      "cmd.list": ({ scope }) => ({
        commands: [...commands.values()].filter((c) => scope.ids.some((p) => starMatch(p, c.id))),
      }),
      "cmd.invoke": ({ id, args }, caller) => {
        const info = commands.get(id);
        if (!info) throw new StubError("not_found", `no command ${id}`);
        const invocationId = fresh("i");
        pending.set(invocationId, { id, caller: me(caller), provider: info.provider });
        later({
          event: "cmd.invoked",
          data: { invocationId, id, caller: me(caller), ...(args ? { args } : {}) },
        });
        return { invocationId };
      },
      "cmd.answer": ({ invocationId, result, error }, caller) => {
        if (pending.get(invocationId)?.provider !== me(caller))
          throw new StubError("not_found", `${me(caller)} has no invocation ${invocationId}`);
        answered(invocationId, result, error);
        return {};
      },
      "perm.request": ({ permission, reason, duration = "session" }, caller) => {
        const asker = me(caller);
        const held = holds(asker, permission);
        if (held) return { granted: true, grant: structuredClone(held.grant) };
        const promptId = fresh("p");
        const data: PermPromptData = { promptId, caller: asker, permission, reason, duration };
        const decide = (granted: boolean, chosen = duration): PermRequestResult =>
          granted ? { granted, grant: give(asker, permission, chosen) } : { granted };
        if (holders(MANAGE).length === 0) return decide(options.prompt?.(data) ?? true);
        later({ event: "perm.prompt", data });
        return new Promise((resolve) => {
          prompts.set(promptId, {
            data,
            decide: (granted, chosen) => {
              prompts.delete(promptId);
              resolve(decide(granted, chosen));
            },
          });
        });
      },
      "perm.answer": ({ promptId, granted, duration, scope }, caller) => {
        check(caller, scope ?? MANAGE);
        const prompt = prompts.get(promptId);
        if (!prompt) throw missing(`a waiting prompt ${promptId}`);
        prompt.decide(granted, duration);
        return {};
      },
      "perm.query": ({ permission }, caller) => {
        const mine = grants.filter((g) => g.caller === me(caller));
        const shown = mine.filter((g) => !permission || covers(g.grant.permission, permission));
        return { grants: structuredClone(shown.map((g) => g.grant)) };
      },
      "perm.list": ({ caller: whose, scope }, caller) => {
        check(caller, scope ?? MANAGE);
        return { grants: structuredClone(grants.filter((g) => (whose ?? g.caller) === g.caller)) };
      },
      "perm.revoke": ({ grantId, scope }, caller) => {
        if (scope) check(caller, scope);
        const held = grants.find((g) => g.grant.grantId === grantId);
        if (!held || (!scope && held.caller !== me(caller)))
          throw missing(`${me(caller)}'s grant ${grantId}`);
        take(grantId, "revoked");
        return {};
      },
      "settings.get": ({ key, owner, scope }, caller) => {
        const id = settingId(owner ?? me(caller), key);
        if ((owner ?? me(caller)) !== me(caller)) {
          const asked = scope ?? { permission: "settings:read", keys: [id] };
          const fits = asked.keys.some((p) => keyMatch(p, id));
          check(caller, asked, fits);
        }
        const setting = settings.get(id);
        return setting === undefined ? {} : { value: structuredClone(setting.value) };
      },
      "settings.set": ({ key, value }, caller) => {
        const setting: Setting = { owner: me(caller), key, value: structuredClone(value) };
        settings.set(settingId(setting.owner, key), setting);
        later({ event: "settings.changed", data: structuredClone(setting) });
        return {};
      },
      "settings.list": ({ scope }, caller) => {
        if (scope) check(caller, scope);
        const shown = (s: Setting) =>
          scope
            ? scope.keys.some((p) => keyMatch(p, settingId(s.owner, s.key)))
            : s.owner === me(caller);
        return { settings: structuredClone(sorted().filter(shown)) };
      },
      "log.write": ({ level, message, fields }, caller) => {
        const entry: LogEntry = { at: now(), channel: me(caller), level, message };
        if (fields) entry.fields = structuredClone(fields);
        log.push(structuredClone(entry));
        later({ event: "log.entry", data: entry });
        return {};
      },
      "log.tail": ({ channel, count = 100, scope }, caller) => {
        if (!Number.isInteger(count) || count < 1 || count > 1000)
          throw new StubError("invalid_params", `count is ${count}; it must be 1 to 1000`);
        check(caller, scope ?? LOG);
        const entries = log.filter((e) => (channel ?? e.channel) === e.channel);
        return { entries: structuredClone(entries.slice(-count)) };
      },
      "events.subscribe": ({ names, scope }, caller) => {
        const asked = scope ?? { permission: "events:subscribe", names };
        const fits = names.every((name) => asked.names.includes(name));
        check(caller, asked, fits);
        const subscriptionId = fresh("sub");
        subscriptions.set(subscriptionId, { caller: me(caller), names: [...names] });
        return { subscriptionId };
      },
      "events.unsubscribe": ({ subscriptionId }, caller) => {
        if (subscriptions.get(subscriptionId)?.caller !== me(caller))
          throw missing(`${me(caller)}'s subscription ${subscriptionId}`);
        subscriptions.delete(subscriptionId);
        return {};
      },
      "ui.surface.open": ({ surface, placement, title, scope }, caller) => {
        check(caller, scope ?? SURFACE);
        const handle = fresh("s");
        const shown = { ...(placement && { placement }), ...(title && { title }) };
        surfaces.set(handle, { handle, caller: me(caller), surface, ...shown });
        return { handle };
      },
      "ui.surface.close": ({ handle, scope }, caller) => {
        check(caller, scope ?? SURFACE);
        if (surfaces.get(handle)?.caller !== me(caller))
          throw missing(`${me(caller)}'s surface ${handle}`);
        surfaces.delete(handle);
        return {};
      },
    },
  };
}
