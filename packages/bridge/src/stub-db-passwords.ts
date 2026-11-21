/**
 * The browser stub's kept database passwords: db.passwords.* (ADR 0311) held in memory instead of
 * the OS keychain, with the core's rules (specs/bridge/v0/README.md): agents refused, a caller's
 * own alone, 256 a caller, none handed back, and a password used by db.open's `passwordRef` only
 * for the host, port and user it was kept for. The stub has no manifest, so keeping one asks for no
 * declaration.
 */
import { StubError, type StubHandlers } from "./adapters";
import type { DbKeptPassword, DbOpenParams } from "./generated";

export type DbPasswordsServed = `db.passwords.${"set" | "delete" | "list"}`;

const MAX_KEPT = 256;

function refuseAgents(caller: string | undefined) {
  if (caller?.startsWith("agent:"))
    throw new StubError("permission_denied", "agents reach databases through the plugin");
}

export function stubDbPasswords() {
  /** Each caller's passwords by name, with what they were kept for. */
  const kept = new Map<string, Map<string, { at: DbKeptPassword; password: string }>>();
  const mine = (caller: string | undefined) => {
    refuseAgents(caller);
    const me = caller ?? "desk";
    const found = kept.get(me) ?? new Map();
    kept.set(me, found);
    return found;
  };

  const handlers: Required<Pick<StubHandlers, DbPasswordsServed>> = {
    "db.passwords.set": (params, caller) => {
      const passwords = mine(caller);
      if (passwords.size >= MAX_KEPT && !passwords.has(params.name))
        throw new StubError("invalid_value", `${caller} already keeps ${MAX_KEPT} passwords`);
      const at = {
        name: params.name,
        host: params.host,
        port: params.port ?? 5432,
        user: params.user,
      };
      passwords.set(params.name, { at, password: params.password });
      return {};
    },
    "db.passwords.delete": (params, caller) => {
      mine(caller).delete(params.name);
      return {};
    },
    "db.passwords.list": (_params, caller) => ({
      passwords: [...mine(caller).values()].map((p) => p.at),
    }),
  };

  return {
    handlers,
    /** The password db.open signs in with: the one given, else the caller's kept one for its
     * `passwordRef` when it was kept for this host, port and user. */
    password: (params: DbOpenParams, caller: string | undefined, port: number) => {
      if (params.passwordRef === undefined) return params.password;
      if (params.password !== undefined)
        throw new StubError("invalid_params", "db.open takes a password or a passwordRef");
      const found = kept.get(caller ?? "desk")?.get(params.passwordRef);
      const fits =
        found?.at.host === params.host && found.at.port === port && found.at.user === params.user;
      return fits ? found.password : undefined;
    },
  };
}
