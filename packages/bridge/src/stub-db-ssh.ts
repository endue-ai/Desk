/**
 * The browser stub's SSH tunnels for db.open's `ssh` (ADR 0359), with the core's rules
 * (specs/bridge/v0/README.md): db:connect covers every hop, a hop's host key is trusted on first
 * use by the caller (the fingerprint accepted in `hostKey`) and a changed one refused until
 * db.hostKeys.delete, a key file whose path says "encrypted" needs `StubSsh.keyPassword`, a
 * password must be `StubSsh.password`, and the SSH host reaches every database but those in
 * `StubSsh.unreachable`. Answers name their hop as the core's do. Nothing connects anywhere.
 */
import { StubError, type StubHandlers } from "./adapters";
import type {
  DbConnectPermission,
  DbOpenParams,
  DbOpenResult,
  DbSshAnswer,
  DbSshHop,
  Permission,
} from "./generated";
import { covers } from "./stub-covers";
import type { StubDatabase } from "./stub-db-types";

export type DbSshServed = "db.hostKeys.delete";

/** The key every scripted SSH server presents unless `StubSsh.hostKeys` names another. */
export const STUB_HOST_KEY = "SHA256:Ubaq9T2onfDuuwg1uOh25iUN5F+a4udq4a2mVJFwMuw";

type Check = (caller: string | undefined, scope: Permission, fits: boolean) => void;
type Open = (params: DbOpenParams, caller: string | undefined) => DbOpenResult;

const WORDS = { jump: "The jump host", host: "The SSH host" } as const;

export function stubDbSsh(script: StubDatabase | undefined, check: Check) {
  /** What each caller trusts, by `host:port`. */
  const trusted = new Map<string, Map<string, string>>();
  const mine = (caller: string | undefined) => {
    if (caller?.startsWith("agent:"))
      throw new StubError("permission_denied", "agents reach databases through the plugin");
    const me = caller ?? "desk";
    const found = trusted.get(me) ?? new Map<string, string>();
    trusted.set(me, found);
    return found;
  };

  /** The first hop that fails, as db.open answers it; undefined when the tunnel opens. */
  const tunnel = (params: DbOpenParams, caller: string | undefined): DbSshAnswer | undefined => {
    const ssh = params.ssh;
    if (!ssh) return undefined;
    const hops: ["jump" | "host", DbSshHop][] = ssh.jump ? [["jump", ssh.jump]] : [];
    hops.push(["host", ssh]);
    for (const [, hop] of hops) {
      const endpoint = {
        permission: "db:connect" as const,
        hosts: [`${hop.host}:${hop.port ?? 22}`],
      };
      check(caller, params.scope, covers(params.scope as DbConnectPermission, endpoint));
    }
    const trust = mine(caller);
    const accepted: [string, string][] = [];
    for (const [which, hop] of hops) {
      const at = `${hop.host}:${hop.port ?? 22}`;
      const fail = (stage: DbSshAnswer["stage"], why: string, more: Partial<DbSshAnswer> = {}) => ({
        hop: which,
        stage,
        message: `${WORDS[which]} ${at} ${why}`,
        ...more,
      });
      const ways = [hop.keyFile, hop.agent, hop.password ?? hop.passwordRef].filter(Boolean);
      if (ways.length !== 1)
        throw new StubError(
          "invalid_params",
          "ssh: exactly one of keyFile, agent, password and passwordRef",
        );
      const fingerprint = script?.ssh?.hostKeys?.[at] ?? STUB_HOST_KEY;
      const known = trust.get(at);
      const key = { algorithm: "ssh-ed25519", fingerprint };
      if (known && known !== fingerprint)
        return fail(
          "hostKey",
          `presented the ssh-ed25519 key ${fingerprint}, not the trusted ${known}: refused.`,
          {
            hostKey: { status: "changed", ...key, known },
          },
        );
      if (!known && hop.hostKey !== fingerprint)
        return fail(
          "hostKey",
          `presented the ssh-ed25519 key ${fingerprint}, which this desk has not trusted yet.`,
          {
            hostKey: { status: "unknown", ...key },
          },
        );
      if (!known) accepted.push([at, fingerprint]);
      const keyFile = `Key file of ${hop.user} on ${WORDS[which].toLowerCase()}: ${hop.keyFile}`;
      if (hop.keyFile?.includes("encrypted") && hop.keyPassword !== script?.ssh?.keyPassword) {
        const needed = !hop.keyPassword;
        return {
          hop: which,
          stage: "auth",
          message: needed
            ? `${keyFile} is encrypted and its passphrase was not given`
            : `${keyFile}: the passphrase does not decrypt it`,
          keyPassword: needed ? "needed" : "wrong",
        };
      }
      if (hop.password !== undefined && hop.password !== script?.ssh?.password)
        return fail("auth", `refused the password for ${hop.user}.`);
      if (hop.passwordRef)
        return fail("auth", `needs ${hop.user}'s password.`, { needsPassword: true });
      if (hop.keyFile && script?.ssh?.refuseKey)
        return fail("auth", `refused the key ${hop.keyFile} for ${hop.user}.`);
    }
    for (const [at, fingerprint] of accepted) trust.set(at, fingerprint);
    const target = `${params.host}:${params.port ?? 5432}`;
    if (script?.ssh?.unreachable?.includes(target)) {
      const at = `${ssh.host}:${ssh.port ?? 22}`;
      return {
        hop: "host",
        stage: "forward",
        message: `The SSH host ${at} could not reach ${target}.`,
      };
    }
    return undefined;
  };

  /** db.open's handler, its tunnel first: a hop that fails answers `ssh` and nothing signs in. */
  const before =
    (open: Open): Open =>
    (params, caller) => {
      const at = `${params.host}:${params.port ?? 5432}`;
      if (params.ssh)
        check(
          caller,
          params.scope,
          covers(params.scope, { permission: "db:connect", hosts: [at] }),
        );
      const answer = tunnel(params, caller);
      return answer ? { ssh: answer } : open(params, caller);
    };

  const handlers: Required<Pick<StubHandlers, DbSshServed>> = {
    "db.hostKeys.delete": (params, caller) => {
      mine(caller).delete(`${params.host}:${params.port ?? 22}`);
      return {};
    },
  };
  return { before, handlers };
}
