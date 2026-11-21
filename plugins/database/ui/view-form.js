// The connection form and the password prompt. The form shows the fields the engine uses (a file
// for SQLite; host, port, database, user and TLS for the others; the keychain choice for PostgreSQL),
// says what is wrong next to the buttons, and hands the fields back on Save or Test. The password
// field is type=password, its value leaves the DOM as soon as it is handed over with the prompt's
// keychain choice, and Escape cancels either.

import { COLORS, SSL_MODES, TAGS } from "./connections.js";

/**
 * @typedef {import("./manage.js").FormModel} FormModel
 * @typedef {import("./manage.js").PasswordModel} PasswordModel
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const PORTS = { postgresql: "5432", mysql: "3306", sqlite: "" };
const DEFAULT_SSL = "the client's default";
const TEXT_FIELDS = /** @type {const} */ ([
  "name",
  "host",
  "port",
  "database",
  "user",
  "sslCa",
  "file",
  "group",
]);

/**
 * @param {Document} doc
 * @param {Act} act
 */
export function createForms(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const form = /** @type {HTMLFormElement} */ (byId("form"));
  const title = byId("form-title");
  const error = byId("form-error");
  const note = byId("form-note");
  const engine = /** @type {HTMLSelectElement} */ (byId("f-engine"));
  const ssl = /** @type {HTMLSelectElement} */ (byId("f-ssl"));
  const tag = /** @type {HTMLSelectElement} */ (byId("f-tag"));
  const color = /** @type {HTMLSelectElement} */ (byId("f-color"));
  const readOnly = /** @type {HTMLInputElement} */ (byId("f-readOnly"));
  const keychain = /** @type {HTMLInputElement} */ (byId("f-keychain"));
  const input = (/** @type {string} */ name) => /** @type {HTMLInputElement} */ (byId(`f-${name}`));
  const prompt = /** @type {HTMLFormElement} */ (byId("password"));
  const promptText = byId("password-text");
  const secret = /** @type {HTMLInputElement} */ (byId("password-value"));
  const remember = /** @type {HTMLInputElement} */ (byId("password-keychain"));
  const rememberLabel = /** @type {HTMLElement} */ (remember.closest("label"));

  for (const mode of SSL_MODES)
    ssl.append(new Option(mode === "default" ? DEFAULT_SSL : mode, mode));
  for (const value of TAGS) tag.append(new Option(value, value));
  COLORS.forEach((value, i) => {
    color.append(new Option(value ? `Colour ${i}` : "none", value));
  });

  /** Show the fields the engine uses: `sqlite`, `server` (the others) or one engine's own. */
  const fitFields = () => {
    const sqlite = engine.value === "sqlite";
    for (const node of form.querySelectorAll("[data-for]")) {
      const wanted = /** @type {HTMLElement} */ (node).dataset.for;
      const shown = wanted === "server" ? !sqlite : wanted === engine.value;
      /** @type {HTMLElement} */ (node).hidden = !shown;
    }
    input("port").placeholder = PORTS[/** @type {keyof typeof PORTS} */ (engine.value)] ?? "";
    // The desk's own PostgreSQL sessions use TLS when the server offers it; MySQL's client decides.
    const first = ssl.options[0];
    if (first)
      first.text =
        engine.value === "postgresql" ? "default: TLS when the server offers it" : DEFAULT_SSL;
  };

  /** @returns {Partial<Connection>} */
  const fields = () => ({
    ...Object.fromEntries(TEXT_FIELDS.map((name) => [name, input(name).value])),
    port: input("port").value === "" ? null : Number(input("port").value),
    engine: /** @type {Connection["engine"]} */ (engine.value),
    ssl: /** @type {Connection["ssl"]} */ (ssl.value),
    tag: /** @type {Connection["tag"]} */ (tag.value),
    readOnly: readOnly.checked,
    keychain: keychain.checked,
    color: color.value,
  });

  // Keep the port as typed when checking for changes, including invalid or padded input.
  const cancelFields = () => ({ ...fields(), port: input("port").value });

  engine.addEventListener("change", fitFields);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    act("formSave", fields());
  });
  byId("form-test").addEventListener("click", () => act("formTest", fields()));
  byId("form-cancel").addEventListener("click", () => act("formCancel", cancelFields()));
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
    // Native select popups have no portable open-state API and can consume their own key events.
    if (
      event.target === engine ||
      event.target === ssl ||
      event.target === tag ||
      event.target === color
    )
      return;
    event.preventDefault();
    act("formCancel", cancelFields());
  });

  prompt.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = secret.value;
    secret.value = "";
    act("password", value, !rememberLabel.hidden && remember.checked);
  });
  byId("password-cancel").addEventListener("click", () => {
    secret.value = "";
    act("password", undefined);
  });
  prompt.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    secret.value = "";
    act("password", undefined);
  });

  return {
    /** @param {FormModel | null} model */
    form(model) {
      const opening = form.hidden;
      form.hidden = model === null;
      if (!model) return;
      title.textContent = model.mode === "edit" ? `Change ${model.fields.name}` : "New connection";
      const conn = model.fields;
      if (opening) {
        for (const name of TEXT_FIELDS)
          input(name).value =
            name === "port"
              ? conn.port === null
                ? ""
                : String(conn.port)
              : String(conn[name] ?? "");
        engine.value = conn.engine;
        ssl.value = conn.ssl;
        tag.value = conn.tag;
        readOnly.checked = conn.readOnly;
        keychain.checked = /** @type {{ keychain?: boolean }} */ (conn).keychain === true;
        color.value = conn.color ?? "";
      }
      // A new error or Test result scrolls into sight above the buttons (the dialog's scroll
      // padding keeps it clear of them).
      const fresh = (/** @type {HTMLElement} */ el, /** @type {string} */ text) =>
        text !== "" && el.textContent !== text;
      const said = fresh(error, model.error) ? error : fresh(note, model.note) ? note : null;
      error.textContent = model.error;
      note.textContent = model.note;
      fitFields();
      if (opening) input("name").focus();
      said?.scrollIntoView?.({ block: "nearest" });
    },
    /** @param {PasswordModel | null} model */
    password(model) {
      prompt.hidden = model === null;
      if (!model) return;
      promptText.textContent = `${model.connection}: ${model.message}`;
      rememberLabel.hidden = model.remember === undefined;
      remember.checked = model.remember === true;
      secret.value = "";
      secret.focus();
    },
  };
}
