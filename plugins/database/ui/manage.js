// Managing connections: the form to add or change one (from blank, a URI or a SQLite file), a test
// that asks the server its version, duplicate, remove (asked first, its history and buffers go with
// it), disconnect (the session's password is forgotten), and the password prompt the executor
// calls when a client needs one. Passwords live in memory only.

import { blank, newId, normalize, parseUri, saveConnections } from "./connections.js";
import { engineOf } from "./engines/index.js";
import { clearHistory } from "./history.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {{ mode: "new" | "edit", fields: Connection, error: string, note: string }} FormModel
 * @typedef {{ connection: string, message: string }} PasswordModel
 * @typedef {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   view: { form(model: FormModel | null): void, password(model: PasswordModel | null): void, say(text: string): void },
 *   pick(title: string, items: { id: string, label: string, detail?: string }[], free?: boolean, placeholder?: string): Promise<string | undefined>,
 *   confirm(title: string, reasons: string[]): Promise<boolean>,
 *   execute: import("./catalog.js").Execute,
 *   forget(connection: string): Promise<void>,
 *   renamed(conn: Connection): Promise<void>,
 *   changed(): void,
 *   random?(): number,
 * }} Deps
 */

/** @param {Deps} deps */
export function createManager(deps) {
  /** @type {Connection[]} */
  let list = [];
  /** @type {Map<string, string>} */
  const passwords = new Map();
  /** @type {FormModel | null} */
  let form = null;
  /** A URI's password, waiting for its connection to be saved. */
  let pending = "";
  /** @type {((value: string | undefined) => void) | null} */
  let answer = null;

  const showForm = () => deps.view.form(form);

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
    form = {
      mode,
      fields: { ...blank(fields.engine ?? "postgresql"), ...fields },
      error: "",
      note: "",
    };
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

  return {
    list: () => list,
    get,
    choose,
    passwords: {
      get: (/** @type {string} */ id) => passwords.get(id),
      set: (/** @type {string} */ id, /** @type {string} */ value) => void passwords.set(id, value),
      /** Ask in the surface; resolves undefined when the person cancels. */
      ask: (/** @type {Connection} */ conn, /** @type {string} */ why) =>
        new Promise((resolve) => {
          answer?.(undefined);
          answer = resolve;
          deps.view.password({ connection: conn.name, message: why });
        }),
    },
    /** The password prompt was answered (a string) or cancelled (undefined). */
    answered(/** @type {string | undefined} */ value) {
      const settle = answer;
      answer = null;
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
          note: "The URI's password is used for this session and never kept.",
        };
        showForm();
      }
    },
    async save(/** @type {Partial<Connection>} */ fields) {
      const conn = checked(fields);
      const next = list.some((c) => c.id === conn.id)
        ? list.map((c) => (c.id === conn.id ? conn : c))
        : [...list, conn];
      await saveConnections(deps.bridge, next);
      list = next;
      if (pending) passwords.set(conn.id, pending);
      pending = "";
      form = null;
      showForm();
      await deps.renamed(conn);
      deps.changed();
      deps.view.say(`Saved ${conn.name}.`);
      return conn;
    },
    /** Ask the server its version with the form's fields. */
    async test(/** @type {Partial<Connection>} */ fields) {
      const conn = checked(fields);
      if (pending) passwords.set(conn.id, pending);
      form = { .../** @type {FormModel} */ (form), error: "", note: "Testing…" };
      showForm();
      const done = await deps.execute(conn, engineOf(conn.engine).versionSql, { catalog: true });
      const error = done.result.error ?? done.result.statements[0]?.error;
      const version = done.result.statements[0]?.sets[0]?.rows[0]?.[0] ?? "";
      if (form) {
        form = {
          ...form,
          error: error ? error.message : "",
          note: error ? "" : `Connected in ${done.result.ms} ms: ${version}`,
        };
        showForm();
      }
      return error ? error.message : version;
    },
    cancelForm() {
      form = null;
      pending = "";
      showForm();
    },
    async remove(/** @type {string | undefined} */ ref) {
      const conn = await choose(ref, "Database: remove which connection?");
      if (!conn) return undefined;
      if (
        !(await deps.confirm(`Remove ${conn.name}?`, [
          "Its console, history and saved settings go too.",
        ]))
      )
        return undefined;
      const next = list.filter((c) => c.id !== conn.id);
      await saveConnections(deps.bridge, next);
      list = next;
      passwords.delete(conn.id);
      await clearHistory(deps.bridge, conn.id);
      await deps.bridge.call("store.set", { key: `console:${conn.id}`, value: "" }).catch(() => {});
      await deps.forget(conn.id);
      deps.changed();
      deps.view.say(`Removed ${conn.name}.`);
      return conn.id;
    },
    /** Forget the session's password and what the explorer read. */
    async disconnect(/** @type {string | undefined} */ ref) {
      const conn = await choose(ref, "Database: disconnect which connection?");
      if (!conn) return undefined;
      passwords.delete(conn.id);
      deps.view.say(`Disconnected ${conn.name}: its password is forgotten.`);
      return conn.id;
    },
    formOpen: () => form !== null,
  };
}
