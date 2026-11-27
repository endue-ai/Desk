// db.open's `ssh` for a connection with a tunnel (PG-10, ADR 0359), and what its answers ask of the
// person. The core opens the tunnel, reads the key file and checks each hop's host key; this module
// names the hops (the jump host first, then the SSH host), lists them in the db:connect scope, and
// when db.open answers `ssh`: a host key not trusted yet is shown with its fingerprint and the open
// goes again with it only once the person says yes; a changed one is refused in words; a key file's
// passphrase or the SSH password is asked and held in memory for the desk's session (never in the
// store, the keychain, a log or the history), forgotten when it is refused. In the background
// (`quiet`) nothing is asked. No DOM.

import { t } from "../strings/index.js";
import { jumpOf, tunneled } from "./fields.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../engines/common.js").DbError} DbError
 * @typedef {import("@endue-ai/bridge").DbOpenResult} Opened
 * @typedef {import("@endue-ai/bridge").DbSshAnswer} Answer
 * @typedef {{ host: string, port: number, user: string }} At
 * @typedef {{
 *   confirm?(title: string, reasons: string[]): Promise<boolean>,
 *   ask?(conn: Connection, why: string): Promise<string | undefined>,
 * }} Deps
 *   `confirm` shows a host key and answers the person's yes; `ask` asks for a secret (hidden).
 */

/** The SSH host and the jump host a connection goes through, the jump host first. */
export function hopsOf(/** @type {Connection} */ conn) {
  if (!tunneled(conn)) return [];
  const host = {
    host: /** @type {string} */ (conn.sshHost),
    port: conn.sshPort ?? 22,
    user: conn.sshUser ?? "",
  };
  return conn.sshJump ? [jumpOf(conn.sshJump, host.user), host] : [host];
}

/** db:connect's scope for a session at `where`: the database's, and every hop's `host:port`. */
export const scopeOf = (/** @type {string} */ where, /** @type {Connection} */ conn) =>
  /** @type {const} */ ({
    permission: "db:connect",
    hosts: [where, ...hopsOf(conn).map((hop) => `${hop.host}:${hop.port}`)],
  });

const WORDS = { jump: "the jump host", host: "the SSH host" };

/** @param {Deps} [deps] */
export function createTunnel(deps = {}) {
  /** Secrets typed this desk session, by connection id and what they are; memory only. */
  const held = /** @type {Map<string, string>} */ (new Map());
  const at = (/** @type {Connection} */ conn, /** @type {string} */ what) =>
    `${conn.id}\n${what}\n${conn.sshKey ?? ""}`;

  /**
   * db.open's ssh: each hop's sign-in, the fingerprints the person accepted, the secrets held.
   * @param {Connection} conn
   * @param {Record<string, string>} accepted by hop
   */
  const params = (conn, accepted) => {
    const hops = hopsOf(conn);
    const key = conn.sshAuth === "key" || conn.sshAuth === undefined;
    const passphrase = held.get(at(conn, "passphrase"));
    const signIn = (/** @type {"jump" | "host"} */ which) => {
      if (key)
        return {
          keyFile: conn.sshKey,
          ...(passphrase === undefined ? {} : { keyPassword: passphrase }),
        };
      if (conn.sshAuth === "password" && which === "host")
        return { password: held.get(at(conn, "password")) ?? "" };
      return { agent: true };
    };
    const hop = (/** @type {At} */ h, /** @type {"jump" | "host"} */ which) => ({
      host: h.host,
      port: h.port,
      user: h.user,
      ...signIn(which),
      ...(accepted[which] ? { hostKey: accepted[which] } : {}),
    });
    const host = /** @type {At} */ (hops.at(-1));
    return {
      ...hop(host, "host"),
      ...(hops.length > 1 ? { jump: hop(/** @type {At} */ (hops[0]), "jump") } : {}),
    };
  };

  /** What the person is asked before a hop's key is trusted. */
  const trust = async (/** @type {Connection} */ conn, /** @type {Answer} */ answer) => {
    const key = answer.hostKey;
    const hop = hopsOf(conn)[answer.hop === "jump" ? 0 : hopsOf(conn).length - 1];
    if (!key || !hop || !deps.confirm) return false;
    return deps.confirm(
      t("tunnel.open.trustTheKeyOf", {
        value: String(WORDS[answer.hop]),
        host: String(hop.host),
        port: String(hop.port),
      }),
      [`${key.algorithm} ${key.fingerprint}`, t("tunnel.open.thisDeskHasNotMetThis")],
    );
  };

  /** Ask for `what` and hold it; false when the person cancels or nothing can ask. */
  const askFor = async (
    /** @type {Connection} */ conn,
    /** @type {"passphrase" | "password"} */ what,
    /** @type {string} */ why,
  ) => {
    const typed = deps.ask ? await deps.ask(conn, why) : undefined;
    if (typed === undefined) return false;
    held.set(at(conn, what), typed);
    return true;
  };

  /**
   * Open with `send`; ask what an answer asks for (unless `quiet`) and open again, a few times at
   * most. The answer that ends it: a session, or the last refusal.
   * @param {Connection} conn
   * @param {boolean} quiet
   * @param {(via: { ssh?: Record<string, unknown> }) => Promise<Opened>} send
   * @returns {Promise<Opened>}
   */
  const open = async (conn, quiet, send) => {
    if (!tunneled(conn)) return send({});
    const host = /** @type {At} */ (hopsOf(conn).at(-1));
    const where = `${host.host}:${host.port}`;
    if (conn.sshAuth === "password" && !held.has(at(conn, "password"))) {
      const why = t("tunnel.open.theSshHostAsksForS", {
        where: String(where),
        user: String(host.user),
      });
      if (quiet || !(await askFor(conn, "password", why)))
        return {
          ssh: {
            hop: "host",
            stage: "auth",
            message: t("tunnel.open.theSshHostNeedsSPassword", {
              where: String(where),
              user: String(host.user),
            }),
            needsPassword: true,
          },
        };
    }
    /** @type {Record<string, string>} */
    const accepted = {};
    let answer = await send({ ssh: params(conn, accepted) });
    for (let tries = 0; tries < 4 && answer.ssh && !quiet; tries++) {
      const failed = answer.ssh;
      if (failed.stage === "hostKey" && failed.hostKey?.status === "unknown") {
        if (!(await trust(conn, failed))) return answer;
        accepted[failed.hop] = failed.hostKey.fingerprint;
      } else if (failed.keyPassword) {
        held.delete(at(conn, "passphrase"));
        const why =
          failed.keyPassword === "wrong"
            ? t("tunnel.open.thePassphraseDoesNotDecryptType", { sshKey: String(conn.sshKey) })
            : t("tunnel.open.isEncryptedTypeItsPassphraseIt", { sshKey: String(conn.sshKey) });
        if (!(await askFor(conn, "passphrase", why))) return answer;
      } else if (failed.stage === "auth" && conn.sshAuth === "password" && failed.hop === "host") {
        held.delete(at(conn, "password"));
        const why = t("tunnel.open.theSshHostRefusedThePassword", {
          where: String(where),
          user: String(host.user),
        });
        if (!(await askFor(conn, "password", why))) return answer;
      } else return answer;
      answer = await send({ ssh: params(conn, accepted) });
    }
    if (answer.ssh?.stage === "auth") {
      held.delete(at(conn, "password"));
      if (answer.ssh.keyPassword) held.delete(at(conn, "passphrase"));
    }
    return answer;
  };

  /** The run's error for a tunnel that did not open: the core's words, naming the hop. */
  const refused = (/** @type {Connection} */ conn, /** @type {Answer} */ answer) => {
    const changed = answer.hostKey?.status === "changed";
    const hint = changed ? t("tunnel.open.ifTheServerSKeyWas") : "";
    return /** @type {DbError} */ ({
      kind: answer.stage === "auth" ? "auth" : "connect",
      message: `${conn.name}: ${answer.message}${hint}`,
    });
  };

  return {
    open,
    refused,
    /** Forget what was typed for the connection `id` (Disconnect, Forget password, Remove). */
    forgetAll: (/** @type {string} */ id) => {
      for (const key of held.keys()) if (key.startsWith(`${id}\n`)) held.delete(key);
    },
  };
}
