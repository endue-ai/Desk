// Managing connections: the form to add or change one (from blank, a URI or a SQLite file), a test
// that asks the server its version, duplicate, remove (asked first, its history and buffers go with
// it), disconnect (the session's password is forgotten), and the password prompt the executor
// calls when a client needs one. Passwords live in memory, and in the OS keychain for a PostgreSQL
// connection whose choice says so (keychain.js, ADR 0311): kept once a typed one works or a URI's
// on Save, forgotten when the choice goes off, the server or user changes, or the connection goes.
// Disconnect, removing a connection and saving a change to how it signs in close its PostgreSQL
// sessions (PG-02), asked first while one is in a transaction.
// An import (features/connections-file/) keeps its connections at once with `adopt`, closing
// sessions as Save does.

import { blank, newId, normalize, parseUri, saveConnections } from "./connections.js";
import { engineOf } from "./engines/index.js";
import { formatDuration } from "./format.js";
import { clearHistory } from "./history.js";
import { chosen, offered, withChoice } from "./keychain.js";

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
 *   random?(): number,
 *   sessions?: { reasons(connection: string): string[], close(connection: string): void },
 *   cancelled?(message: string): Error,
 * }} Deps
 *   `sessions` are the connection's kept PostgreSQL sessions: what closing them ends, and the close.
 */

/** The fields a session signs in with: a change to any closes the connection's sessions. */
const SIGN_IN = /** @type {const} */ ([
  "engine",
  "host",
  "port",
  "database",
  "user",
  "ssl",
  "sslCa",
  "readOnly",
]);

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
  /** A URI's password, waiting for its connection to be saved. */
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
  /** Whether the person lets the connection's sessions close, asked while one is in a transaction. */
  const letClose = async (/** @type {Connection} */ conn, /** @type {string} */ title) => {
    const reasons = deps.sessions?.reasons(conn.id) ?? [];
    return reasons.length === 0 || deps.confirm(title, reasons);
  };

  const get = (/** @type {string} */ ref) =>
    list.find((c) => c.id === ref) ?? list.find((c) => c.name.toLowerCase() === ref.toLowerCase());

  /** The connection a command names, or the one the person picks. */
  const choose = async (/** @type {string | undefined} */ ref, /** @type {string} */ title) => {
    if (ref) {
      const found = get(ref);
      if (!found) throw new Error(`No connection is named ${ref}.`);
      return found;
    }
    if (list.length === 0)
      throw new Error("No connections yet: add one with Database: new connection.");
    if (list.length === 1) return /** @type {Connection} */ (list[0]);
    const items = list.map((c) => ({
      id: c.id,
      label: c.name,
      detail: `${engineOf(c.engine).title}${c.tag !== "none" ? ` · ${c.tag}` : ""}`,
    }));
    const picked = await deps.pick(title, items);
    return picked ? get(picked) : undefined;
  };

  /** Open the form, for a new connection or to change one. */
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

  /** Check the form's fields into a connection, or show what is wrong and throw. */
  const checked = (/** @type {Partial<Connection>} */ fields) => {
    if (!form) throw new Error("The form is closed.");
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

  /** Turn the connection's keychain choice on or off, and keep the list. */
  const setChoice = async (/** @type {Connection} */ conn, /** @type {boolean} */ on) => {
    if (chosen(conn) === on) return;
    const next = list.map((c) => (c.id === conn.id ? withChoice(c, on) : c));
    await saveConnections(deps.bridge, next);
    list = next;
    deps.changed();
  };

  /** Keep a password that worked in the keychain, saying how it went; a failure keeps it in memory. */
  const keep = async (/** @type {Connection} */ conn, /** @type {string} */ value) => {
    try {
      await deps.keychain.keep(conn, value);
      deps.view.say(`The keychain remembers the password of ${conn.name}.`);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      deps.view.say(
        `The keychain did not take the password of ${conn.name} (${why}): it is kept until you disconnect.`,
      );
    }
  };

  /** Forget what the keychain keeps for the connection; a failure is said, never thrown. */
  const forgetKept = async (/** @type {Connection} */ conn) => {
    try {
      return await deps.keychain.forget(conn.id);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      deps.view.say(`The keychain still keeps the password of ${conn.name}: ${why}`);
      return false;
    }
  };

  /** A typed password worked: keep it, or forget the kept one, as the prompt's choice says. */
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
      /** Ask in the surface; resolves undefined when the person cancels. */
      ask: (/** @type {Connection} */ conn, /** @type {string} */ why) =>
        new Promise((resolve) => {
          answer?.(undefined);
          answer = resolve;
          asking = conn;
          const remember = offered(conn) ? { remember: chosen(conn) } : {};
          deps.view.password({ connection: conn.name, message: why, ...remember });
        }),
    },
    /** The password prompt was answered (a string, with the keychain choice) or cancelled. */
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
      const conn = await choose(ref, "Database: change which connection?");
      if (conn) open("edit", conn);
    },
    async duplicate(/** @type {string | undefined} */ ref) {
      const conn = await choose(ref, "Database: duplicate which connection?");
      if (conn) open("new", { ...conn, id: "", name: `${conn.name} copy` });
    },
    /** A URI typed or handed in: its fields in the form, its password kept for the save. */
    async importUri(/** @type {string | undefined} */ uri) {
      const typed =
        uri ??
        (await deps.pick("Database: connection URI", [], true, "postgresql://user@host:5432/db"));
      if (!typed) return;
      const { fields, password } = parseUri(typed);
      open("new", { ...fields, id: "" });
      pending = password ?? "";
      if (password !== undefined) {
        form = {
          .../** @type {FormModel} */ (form),
          note: "The URI's password is used for this session, and kept only when the keychain remembers it.",
        };
        showForm();
      }
    },
    async save(/** @type {Partial<Connection>} */ fields) {
      const conn = checked(fields);
      const before = form?.mode === "edit" ? list.find((c) => c.id === conn.id) : undefined;
      const signIn = before && SIGN_IN.some((key) => (before[key] ?? "") !== (conn[key] ?? ""));
      if (before && signIn && !(await letClose(before, `Save ${before.name}?`))) {
        deps.view.say(`Not saved: ${before.name}'s sessions stay open.`);
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
      deps.view.say(`Saved ${conn.name}.`);
      return conn;
    },
    /** Ask the server its version with the form's fields. */
    async test(/** @type {Partial<Connection>} */ fields) {
      const conn = checked(fields);
      const session = formSession;
      if (pending) passwords.set(conn.id, pending);
      form = {
        .../** @type {FormModel} */ (form),
        fields: { .../** @type {FormModel} */ (form).fields, ...fields },
        error: "",
        note: "Testing…",
      };
      showForm();
      const done = await deps.execute(conn, engineOf(conn.engine).versionSql, { catalog: true });
      const error = done.result.error ?? done.result.statements[0]?.error;
      const version = done.result.statements[0]?.sets[0]?.rows[0]?.[0] ?? "";
      if (form && session === formSession) {
        form = {
          ...form,
          error: error ? error.message : "",
          note: error ? "" : `Connected in ${formatDuration(done.result.ms)}: ${version}`,
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
        if (key === "keychain") return value !== (before === true);
        return value !== (key === "port" ? String(before ?? "") : before);
      });
      if (changed) {
        if (confirming === session) return;
        confirming = session;
        let discard;
        try {
          discard = await deps.confirm("Discard changes to this connection?", [
            "The fields you changed will be lost.",
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
      const conn = await choose(ref, "Database: remove which connection?");
      if (!conn) return undefined;
      const reasons = [
        "Its console, history and saved settings go too.",
        ...(deps.sessions?.reasons(conn.id) ?? []),
      ];
      if (!(await deps.confirm(`Remove ${conn.name}?`, reasons))) return undefined;
      deps.sessions?.close(conn.id);
      const next = list.filter((c) => c.id !== conn.id);
      await saveConnections(deps.bridge, next);
      list = next;
      passwords.delete(conn.id);
      await forgetKept(conn);
      await clearHistory(deps.bridge, conn.id);
      await deps.bridge.call("store.set", { key: `console:${conn.id}`, value: "" }).catch(() => {});
      await deps.forget(conn.id);
      deps.changed();
      deps.view.say(`Removed ${conn.name}.`);
      return conn.id;
    },
    /** Close the connection's sessions and forget its password. */
    async disconnect(/** @type {string | undefined} */ ref) {
      const conn = await choose(ref, "Database: disconnect which connection?");
      if (!conn) return undefined;
      if (!(await letClose(conn, `Disconnect ${conn.name}?`))) throw refused("Not disconnected.");
      deps.sessions?.close(conn.id);
      passwords.delete(conn.id);
      const closed = conn.engine === "postgresql" ? "its sessions are closed and " : "";
      const kept = deps.keychain.has(conn) ? "; the keychain still remembers it" : "";
      deps.view.say(`Disconnected ${conn.name}: ${closed}its password is forgotten${kept}.`);
      return conn.id;
    },
    /** Disconnect and forget: the session's password, the keychain's, and the choice. */
    async forgetPassword(/** @type {string | undefined} */ ref) {
      const conn = await choose(ref, "Database: forget the password of which connection?");
      if (!conn) return undefined;
      passwords.delete(conn.id);
      const was = await forgetKept(conn);
      await setChoice(conn, false);
      deps.view.say(
        was
          ? `Forgot the password of ${conn.name}: the keychain no longer remembers it.`
          : `Forgot the password of ${conn.name}: the keychain kept none.`,
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
        if (!(await letClose(c, `Import over ${c.name}?`)))
          throw refused(`Not imported: ${c.name}'s sessions stay open.`);
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
