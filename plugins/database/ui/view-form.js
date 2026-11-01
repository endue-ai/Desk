// The connection form and the password prompt. The form shows the fields the engine uses (a file
// for SQLite; host, port, database, user and TLS for the others), says what is wrong next to the
// buttons, and hands the fields back on Save or Test. The password field is type=password, its value
// leaves the DOM as soon as it is handed over, and Escape cancels either.

import { SSL_MODES, TAGS } from "./connections.js";

/**
 * @typedef {import("./manage.js").FormModel} FormModel
 * @typedef {import("./manage.js").PasswordModel} PasswordModel
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const PORTS = { postgresql: "5432", mysql: "3306", sqlite: "" };
const TEXT_FIELDS = /** @type {const} */ ([
  "name",
  "host",
  "port",
  "database",
  "user",
  "sslCa",
  "file",
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
  const readOnly = /** @type {HTMLInputElement} */ (byId("f-readOnly"));
  const input = (/** @type {string} */ name) => /** @type {HTMLInputElement} */ (byId(`f-${name}`));
  const prompt = /** @type {HTMLFormElement} */ (byId("password"));
  const promptText = byId("password-text");
  const secret = /** @type {HTMLInputElement} */ (byId("password-value"));

  for (const mode of SSL_MODES)
    ssl.append(new Option(mode === "default" ? "the client's default" : mode, mode));
  for (const value of TAGS) tag.append(new Option(value, value));

  /** Show the fields the engine uses. */
  const fitFields = () => {
    const sqlite = engine.value === "sqlite";
    for (const node of form.querySelectorAll("[data-for]")) {
      const wanted = /** @type {HTMLElement} */ (node).dataset.for;
      /** @type {HTMLElement} */ (node).hidden = wanted === "sqlite" ? !sqlite : sqlite;
    }
    input("port").placeholder = PORTS[/** @type {keyof typeof PORTS} */ (engine.value)] ?? "";
  };

  /** @returns {Partial<Connection>} */
  const fields = () => ({
    ...Object.fromEntries(TEXT_FIELDS.map((name) => [name, input(name).value])),
    port: input("port").value === "" ? null : Number(input("port").value),
    engine: /** @type {Connection["engine"]} */ (engine.value),
    ssl: /** @type {Connection["ssl"]} */ (ssl.value),
    tag: /** @type {Connection["tag"]} */ (tag.value),
    readOnly: readOnly.checked,
  });

  engine.addEventListener("change", fitFields);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    act("formSave", fields());
  });
  byId("form-test").addEventListener("click", () => act("formTest", fields()));
  byId("form-cancel").addEventListener("click", () => act("formCancel"));
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    act("formCancel");
  });

  prompt.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = secret.value;
    secret.value = "";
    act("password", value);
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
      error.textContent = model.error;
      note.textContent = model.note;
      fitFields();
      if (opening) input("name").focus();
    },
    /** @param {PasswordModel | null} model */
    password(model) {
      prompt.hidden = model === null;
      if (!model) return;
      promptText.textContent = `${model.connection}: ${model.message}`;
      secret.value = "";
      secret.focus();
    },
  };
}
