// db.open's tls for a PostgreSQL connection (ADR 0281, ADR 0331): the mode, the CA file's PEM for
// the modes that check certificates, and the client certificate and key files' PEM when the
// connection names them. Each file is read with fs.read under the plugin's fs:read grant (asked
// once for the certificate and the key together); a file that cannot be read is said with its
// field's name before anything connects. An encrypted key's passphrase is asked when db.open
// answers keyPassword, held in memory by `passphrases` (never in the store, the keychain, a log or
// the history) and forgotten when it is wrong. A path typed on Windows is read with slashes, as the
// bridge reads paths (platform.js). No DOM.

import { readScope, withGrant } from "../console-files.js";
import { bridgePath } from "../platform.js";
import { t } from "../strings/index.js";

/**
 * @typedef {import("./common.js").Connection} Connection
 * @typedef {import("./common.js").DbError} DbError
 * @typedef {{ mode: string, ca?: string, cert?: string, key?: string, keyPassword?: string }} Tls
 * @typedef {import("@endue-ai/bridge").DbOpenResult} Opened
 * @typedef {{
 *   get(conn: Connection): string | undefined,
 *   set(conn: Connection, value: string): void,
 *   forget(conn: Connection): void,
 *   ask(conn: Connection, why: string): Promise<string | undefined>,
 * }} Passphrases
 *   What the person typed for a connection's key file, in memory for the desk's session.
 */

/** @type {Passphrases} */
const NONE = {
  get: () => undefined,
  set: () => {},
  forget: () => {},
  ask: async () => undefined,
};

const textOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * Key files' passphrases typed this desk session, by connection id and key path; memory only.
 * @param {(conn: Connection, why: string) => Promise<string | undefined>} ask
 */
export function createPassphrases(ask) {
  const held = /** @type {Map<string, string>} */ (new Map());
  const at = (/** @type {Connection} */ conn) => `${conn.id}\n${conn.sslKey ?? ""}`;
  return {
    get: (/** @type {Connection} */ conn) => held.get(at(conn)),
    set: (/** @type {Connection} */ conn, /** @type {string} */ value) =>
      void held.set(at(conn), value),
    forget: (/** @type {Connection} */ conn) => void held.delete(at(conn)),
    ask,
    /** Every passphrase of the connection `id` (Disconnect, Forget password, Remove). */
    forgetAll: (/** @type {string} */ id) => {
      for (const key of held.keys()) if (key.startsWith(`${id}\n`)) held.delete(key);
    },
  };
}

/** Whether the connection presents a client certificate: PostgreSQL, both files, TLS not off. */
export const presents = (/** @type {Connection} */ conn) =>
  Boolean(conn.sslCert && conn.sslKey) && conn.ssl !== "disable";

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @param {Passphrases} [passphrases]
 */
export function createTls(bridge, passphrases = NONE) {
  /** @param {string} method @param {Record<string, unknown>} params @returns {Promise<any>} */
  const call = (method, params) => bridge.call(/** @type {never} */ (method), params);

  /** A file's text under `scope`; its failure names `field`. */
  const read = async (
    /** @type {string} */ field,
    /** @type {string} */ path,
    /** @type {import("../console-files.js").FsScope} */ scope,
    /** @type {string} */ reason,
  ) => {
    try {
      const fetch = () => call("fs.read", { path, encoding: "utf8", scope });
      return String((await withGrant(bridge, scope, fetch, reason)).content);
    } catch (error) {
      throw new Error(`${field}: ${textOf(error)}`);
    }
  };

  /** The client certificate and key files' PEM, checked for what each must hold. */
  const client = async (/** @type {Connection} */ conn) => {
    const cert = bridgePath(/** @type {string} */ (conn.sslCert));
    const key = bridgePath(/** @type {string} */ (conn.sslKey));
    // One grant for both files: each read names its own file first, so a failure names it.
    const scope = (/** @type {string} */ first) => ({
      ...readScope(first),
      paths: [...new Set([first, cert, key])],
    });
    const reason = `To present ${conn.name}'s client certificate`;
    const certPem = await read("Certificate file", cert, scope(cert), reason);
    if (!certPem.includes("-----BEGIN CERTIFICATE-----"))
      throw new Error(
        t("engines.pgTls.certificateFileHoldsNoPemCertificate", { cert: String(cert) }),
      );
    const keyPem = await read("Key file", key, scope(key), reason);
    if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(keyPem))
      throw new Error(t("engines.pgTls.keyFileHoldsNoPemPrivate", { key: String(key) }));
    return { cert: certPem, key: keyPem };
  };

  /**
   * db.open's tls: none for the default without a certificate (the core's prefer), the CA file's
   * PEM when one is set, the certificate and key when both are. Throws the sentence to show.
   * @param {Connection} conn
   * @returns {Promise<Tls | undefined>}
   */
  const of = async (conn) => {
    const cert = presents(conn) ? await client(conn) : undefined;
    if (conn.ssl === "default" && !cert) return undefined;
    const mode = conn.ssl === "default" ? "prefer" : conn.ssl;
    /** @type {Tls} */
    const tls = { mode, ...cert };
    if (conn.ssl !== "disable" && conn.sslCa) {
      const path = bridgePath(conn.sslCa);
      const scope = readScope(path);
      const fetch = () => call("fs.read", { path, encoding: "utf8", scope });
      const file = await withGrant(bridge, scope, fetch, `To trust ${conn.name}'s certificates`);
      tls.ca = String(file.content);
    }
    return tls;
  };

  /**
   * Open with `send`; when the key wants its passphrase, the one in memory, else ask (unless
   * `quiet`) and open again once. A passphrase that opened is held; a wrong one is forgotten.
   * @param {Connection} conn
   * @param {Tls | undefined} tls
   * @param {boolean} quiet
   * @param {(tls: Tls | undefined) => Promise<Opened>} send
   * @returns {Promise<Opened>}
   */
  const open = async (conn, tls, quiet, send) => {
    const held = tls?.key ? passphrases.get(conn) : undefined;
    const first = await send(held && tls ? { ...tls, keyPassword: held } : tls);
    if (!first.keyPassword || !tls) return first;
    passphrases.forget(conn);
    if (quiet) return first;
    const why =
      first.keyPassword === "wrong" && held
        ? `the passphrase of ${conn.sslKey} no longer decrypts it: type it again. It is used for this session and never kept.`
        : `${conn.sslKey} is encrypted: type its passphrase. It is used for this session and never kept.`;
    const typed = await passphrases.ask(conn, why);
    if (typed === undefined) return first;
    const again = await send({ ...tls, keyPassword: typed });
    if (!again.keyPassword) passphrases.set(conn, typed);
    return again;
  };

  /** The run's error for a key whose passphrase was not typed or did not decrypt it. @returns {DbError} */
  const refused = (/** @type {Connection} */ conn, /** @type {string} */ why) => ({
    kind: "connect",
    message:
      why === "wrong"
        ? t("engines.pgTls.keyFileThePassphraseDoesNot", { sslKey: String(conn.sslKey) })
        : t("engines.pgTls.keyFileIsEncryptedAndIts", { sslKey: String(conn.sslKey) }),
  });

  return { of, open, refused };
}
