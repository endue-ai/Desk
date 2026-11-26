// The connection form adds or changes a blank, URI or SQLite connection. It tests the server version,
// duplicates, disconnects and confirms removal with the connection's history and buffers. The
// executor prompts for passwords, which stay in memory unless the person keeps one in the OS
// keychain (ADR 0311). A valid password or a saved URI password is stored there on request.
// Turning off that choice, changing the server or user, or removing the connection forgets it.
// Disconnect, removal and sign-in changes close PostgreSQL sessions after confirming a transaction.
// A key file's passphrase (ADR 0331) is asked in the same prompt and forgotten with the password.
// An import (features/connections-file/) keeps its connections at once with `adopt`, closing
// sessions as Save does.

import { chooseConnection, findConnection } from "./choose-connection.js";
import { disconnectedMessage } from "./connection-messages.js";
import { blank, newId, normalize, parseUri, SIGN_IN, saveConnections } from "./connections.js";
import { engineOf } from "./engines/index.js";
import { formatDuration } from "./format.js";
import { clearHistory } from "./history.js";
import { chosen, offered, withChoice } from "./keychain.js";
import { t } from "./strings/index.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {{ mode: "new" | "edit", fields: Connection, error: string, note: string }} FormModel
 * @typedef {{ connection: string, message: string, remember?: boolean }} PasswordModel
 *   `remember` is the keychain choice, when the connection may keep its password there.
 * @typedef {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   view: { form(model: FormModel | null): void, password(model: PasswordModel | null): void, say(text: string): void, focus(where: "explorer"): void },
 *   pick(title: string, items: { id: string, label: string, detail?: string }[], free?: boolean, placeholder?: string): Promise<string | undefined>,
 *   confirm(title: string, reasons: string[]): Promise<boolean>,
 *   execute: import("./catalog.js").Execute,
 *   keychain: ReturnType<typeof import("./keychain.js").createKeychain>,
 *   forget(connection: string): Promise<void>,
 *   renamed(conn: Connection): Promise<void>,
 *   changed(): void,
 *   random?(): number, reviewConnection?(conn: Connection): Promise<boolean>,
 *   sessions?: {
 *     reasons(connection: string): string[],
 *     close(connection: string): void,
 *     disconnect?(connection: string): void,
 *     forget?(connection: string): void,
 *   },
 *   cancelled?(message: string): Error,
 * }} Deps
 *   `sessions` are the connection's kept PostgreSQL sessions: what closing them ends, and the close.
 */

/** @param {Deps} deps */
export function createManager(deps) {
  /** @type {Connection[]} */
  let list = [];
  /** @type {Map<string, string>} */
  const passwords = new Map();
  /** @type {FormModel | null} */
  let form = null;
  /** @type {Connection | null} */
  let opened = null;
  let formSession = 0;
  let confirming = 0;
  let pending = "";
  /** @type {((value: string | undefined) => void) | null} */
  let answer = null;
  /** The connection the prompt asks for. @type {Connection | null} */
  let asking = null;
  /** The prompt's keychain choice, by connection, until its password works. @type {Map<string, boolean>} */
  const choices = new Map();

  const showForm = () => deps.view.form(form);
  const refused = (/** @type {string} */ message) =>
    deps.cancelled?.(message) ?? Object.assign(new Error(message), { code: "cancelled" });
  const letClose = async (/** @type {Connection} */ conn, /** @type {string} */ title) => {
    const reasons = deps.sessions?.reasons(conn.id) ?? [];
    return reasons.length === 0 || deps.confirm(title, reasons);
  };

  const get = (/** @type {string} */ ref) => findConnection(list, ref);
  const choose = (/** @type {string | undefined} */ ref, /** @type {string} */ title) =>
    chooseConnection(
      () => list,
      (prompt, items) => deps.pick(prompt, items),
      ref,
      title,
    );

  const open = (/** @type {"new" | "edit"} */ mode, /** @type {Partial<Connection>} */ fields) => {
    if (form) deps.view.form(null);
    form = {
      mode,
      fields: { ...blank(fields.engine ?? "postgresql"), ...fields },
      error: "",
      note: "",
    };
    opened = { ...form.fields };
    formSession++;
    showForm();
  };

  const checked = (/** @type {Partial<Connection>} */ fields) => {
    if (!form) throw new Error(t("manage.theFormIsClosed"));
    const id = form.mode === "edit" ? form.fields.id : form.fields.id || newId(deps.random);
    try {
      return normalize({ ...fields, id }, list);
    } catch (error) {
      form = {
        ...form,
        fields: { ...form.fields, ...fields },
        error: error instanceof Error ? error.message : String(error),
        note: "",
      };
      showForm();
      throw error;
    }
  };

  const setChoice = async (/** @type {Connection} */ conn, /** @type {boolean} */ on) => {
    if (chosen(conn) === on) return;
    const next = list.map((c) => (c.id === conn.id ? withChoice(c, on) : c));
    await saveConnections(deps.bridge, next);
    list = next;
    deps.changed();
  };

  const keep = async (/** @type {Connection} */ conn, /** @type {string} */ value) => {
    try {
      await deps.keychain.keep(conn, value);
      deps.view.say(t("manage.theKeychainRemembersThePasswordOf", { name: String(conn.name) }));
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      deps.view.say(
        t("manage.theKeychainDidNotTakeThe", { name: String(conn.name), why: String(why) }),
      );
    }
  };

  const forgetKept = async (/** @type {Connection} */ conn) => {
    try {
      return await deps.keychain.forget(conn.id);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      deps.view.say(
        t("manage.theKeychainStillKeepsThePassword", { name: String(conn.name), why: String(why) }),
      );
      return false;
    }
  };

  const settleChoice = async (/** @type {string} */ id, /** @type {string} */ value) => {
    const remember = choices.get(id);
    choices.delete(id);
    const conn = get(id);
    if (remember === undefined || !conn) return;
    await setChoice(conn, remember);
    if (remember) await keep(/** @type {Connection} */ (get(id)), value);
    else await forgetKept(conn);
  };

  return {
    list: () => list,
    get,
    choose,
    passwords: {
      get: (/** @type {string} */ id) => passwords.get(id),
      set: (/** @type {string} */ id, /** @type {string} */ value) => {
        passwords.set(id, value);
        void settleChoice(id, value);
      },
      /** The name db.open takes as passwordRef when the keychain keeps the connection's password. */
      ref: (/** @type {Connection} */ conn) => deps.keychain.ref(conn),
      /** Ask in the surface; undefined when cancelled. A key file's passphrase: no keychain. */
      ask: (/** @type {Connection} */ conn, /** @type {string} */ why, keyFile = false) =>
        new Promise((resolve) => {
          answer?.(undefined);
          answer = resolve;
          asking = keyFile ? null : conn;
          const remember = !keyFile && offered(conn) ? { remember: chosen(conn) } : {};
          deps.view.password({ connection: conn.name, message: why, ...remember });
        }),
    },
    answered(/** @type {string | undefined} */ value, /** @type {boolean} */ remember = false) {
      const settle = answer;
      if (value !== undefined && asking && offered(asking)) choices.set(asking.id, remember);
      answer = null;
      asking = null;
      deps.view.password(null);
      settle?.(value);
    },
    replace(/** @type {Connection[]} */ next) {
      list = next;
      deps.changed();
    },
    create(/** @type {Partial<Connection>} */ fields = {}) {
      pending = "";
      open("new", { ...fields, id: "" });
    },
    async edit(/** @type {string | undefined} */ ref) {
      const conn = await choose(ref, t("manage.databaseChangeWhichConnection"));
      if (conn) open("edit", conn);
    },
    async duplicate(/** @type {string | undefined} */ ref) {
      const conn = await choose(ref, t("manage.databaseDuplicateWhichConnection"));
      if (conn) open("new", { ...conn, id: "", name: `${conn.name} copy` });
    },
    async importUri(/** @type {string | undefined} */ uri) {
      const typed =
        uri ??
        (await deps.pick(
          t("manage.databaseConnectionUri"),
          [],
          true,
          "postgresql://user@host:5432/db",
        ));
      if (!typed) return;
      const { fields, password } = parseUri(typed);
      open("new", { ...fields, id: "" });
      pending = password ?? "";
      if (password !== undefined) {
        form = {
          .../** @type {FormModel} */ (form),
          note: t("manage.theUriSPasswordIsUsed"),
        };
        showForm();
      }
    },
    async save(/** @type {Partial<Connection>} */ fields) {
      const conn = checked(fields);
      const session = formSession;
      const before = form?.mode === "edit" ? list.find((c) => c.id === conn.id) : undefined;
      const signIn = before && SIGN_IN.some((key) => (before[key] ?? "") !== (conn[key] ?? ""));
      if (
        before &&
        signIn &&
        !(await letClose(before, t("manage.save", { name: String(before.name) })))
      ) {
        deps.view.say(t("manage.notSavedSSessionsStayOpen", { name: String(before.name) }));
        return undefined;
      }
      const allowed = await deps.reviewConnection?.(conn);
      if (session !== formSession) return undefined;
      if (allowed === false) {
        deps.view.say(t("manage.notSavedConnectingToWasRefused", { name: String(conn.name) }));
        return undefined;
      }
      if (signIn) deps.sessions?.close(conn.id);
      const next = list.some((c) => c.id === conn.id)
        ? list.map((c) => (c.id === conn.id ? conn : c))
        : [...list, conn];
      await saveConnections(deps.bridge, next);
      list = next;
      if (pending) passwords.set(conn.id, pending);
      // A kept password goes with the choice, and with the server or user it was kept for.
      if (deps.keychain.holds(conn.id) && !(chosen(conn) && deps.keychain.has(conn)))
        await forgetKept(conn);
      if (pending && chosen(conn)) await keep(conn, pending);
      pending = "";
      form = null;
      opened = null;
      formSession++;
      showForm();
      deps.view.focus("explorer");
      await deps.renamed(conn);
      deps.changed();
      deps.view.say(t("manage.saved", { name: String(conn.name) }));
      return conn;
    },
    async test(/** @type {Partial<Connection>} */ fields) {
      const conn = checked(fields);
      const session = formSession;
      if (pending) passwords.set(conn.id, pending);
      form = {
        .../** @type {FormModel} */ (form),
        fields: { .../** @type {FormModel} */ (form).fields, ...fields, id: conn.id },
        error: "",
        note: "Testing…",
      };
      showForm();
      const options = { catalog: true, permissionsReviewed: deps.reviewConnection !== undefined };
      const allowed = await deps.reviewConnection?.(conn);
      if (session !== formSession) return undefined;
      const done =
        allowed === false
          ? undefined
          : await deps.execute(conn, engineOf(conn.engine).versionSql, options);
      const error = done
        ? (done.result.error ?? done.result.statements[0]?.error)
        : { message: t("manage.connectingToWasRefused", { name: String(conn.name) }) };
      const version = done?.result.statements[0]?.sets[0]?.rows[0]?.[0] ?? "";
      if (form && session === formSession) {
        form = {
          ...form,
          error: error ? error.message : "",
          note: done && !error ? `Connected in ${formatDuration(done.result.ms)}: ${version}` : "",
        };
        showForm();
      }
      return error ? error.message : version;
    },
    async cancelForm(/** @type {Omit<Partial<Connection>, "port"> & { port: string }} */ fields) {
      if (!form || !opened) return;
      const session = formSession;
      const original = opened;
      const changed = Object.entries(fields).some(([key, value]) => {
        const before = original[/** @type {keyof Connection} */ (key)];
        if (key === "keychain" || key === "pooler") return value !== (before === true);
        return value !== (key === "port" ? String(before ?? "") : before);
      });
      if (changed) {
        if (confirming === session) return;
        confirming = session;
        let discard;
        try {
          discard = await deps.confirm(t("manage.discardChangesToThisConnection"), [
            t("manage.theFieldsYouChangedWillBe"),
          ]);
        } finally {
          if (confirming === session) confirming = 0;
        }
        if (!discard || session !== formSession || !form) return;
      }
      form = null;
      opened = null;
      formSession++;
      pending = "";
      showForm();
      deps.view.focus("explorer");
    },
    async remove(/** @type {string | undefined} */ ref) {
      const conn = await choose(ref, t("manage.databaseRemoveWhichConnection"));
      if (!conn) return undefined;
      const reasons = [
        t("manage.itsConsoleHistoryAndSavedSettings"),
        ...(deps.sessions?.reasons(conn.id) ?? []),
      ];
      if (!(await deps.confirm(t("manage.remove", { name: String(conn.name) }), reasons)))
        return undefined;
      deps.sessions?.close(conn.id);
      const next = list.filter((c) => c.id !== conn.id);
      await saveConnections(deps.bridge, next);
      list = next;
      passwords.delete(conn.id);
      deps.sessions?.forget?.(conn.id);
      await forgetKept(conn);
      await clearHistory(deps.bridge, conn.id);
      await deps.bridge.call("store.set", { key: `console:${conn.id}`, value: "" }).catch(() => {});
      await deps.forget(conn.id);
      deps.changed();
      deps.view.say(t("manage.removed", { name: String(conn.name) }));
      return conn.id;
    },
    /** Close the connection's sessions and forget its password. */
    async disconnect(/** @type {string | undefined} */ ref) {
      const conn = await choose(ref, t("manage.databaseDisconnectWhichConnection"));
      if (!conn) return undefined;
      if (!(await letClose(conn, t("manage.disconnect", { name: String(conn.name) }))))
        throw refused(t("manage.notDisconnected"));
      deps.sessions?.disconnect?.(conn.id);
      deps.sessions?.close(conn.id);
      passwords.delete(conn.id);
      deps.sessions?.forget?.(conn.id);
      deps.view.say(disconnectedMessage(conn, deps.keychain.has(conn)));
      return conn.id;
    },
    /** Disconnect and forget: the session's password, the keychain's, and the choice. */
    async forgetPassword(/** @type {string | undefined} */ ref) {
      const conn = await choose(ref, t("manage.databaseForgetThePasswordOfWhich"));
      if (!conn) return undefined;
      passwords.delete(conn.id);
      deps.sessions?.forget?.(conn.id);
      const was = await forgetKept(conn);
      await setChoice(conn, false);
      deps.view.say(
        was
          ? t("manage.forgotThePasswordOfTheKeychain", { name: String(conn.name) })
          : t("manage.forgotThePasswordOfTheKeychain2", { name: String(conn.name) }),
      );
      return conn.id;
    },
    /** Connections from a file, each added or over the one with its id, kept at once as Save keeps one. */
    async adopt(/** @type {Connection[]} */ incoming) {
      const byId = new Map(incoming.map((c) => [c.id, c]));
      const next = [
        ...list.map((c) => byId.get(c.id) ?? c),
        ...incoming.filter((c) => !list.some((o) => o.id === c.id)),
      ];
      for (const conn of incoming) normalize(conn, next);
      const moved = list.filter((c) => SIGN_IN.some((k) => (byId.get(c.id) ?? c)[k] !== c[k]));
      for (const c of moved)
        if (!(await letClose(c, t("manage.importOver", { name: String(c.name) }))))
          throw refused(t("manage.notImportedSSessionsStayOpen", { name: String(c.name) }));
      for (const c of moved) deps.sessions?.close(c.id);
      await saveConnections(deps.bridge, next);
      list = next;
      for (const conn of incoming) {
        if (deps.keychain.holds(conn.id) && !(chosen(conn) && deps.keychain.has(conn)))
          await forgetKept(conn);
        await deps.renamed(conn);
      }
      deps.changed();
    },
    formOpen: () => form !== null,
  };
}
