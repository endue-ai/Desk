// The Screen Sharing page: the toolbar (the computer, its state, View only, Fit, Disconnect), the
// kept computers and the form that adds one, the screen noVNC draws into, and the two questions a
// connection may ask: the sign-in (a user name and a password, never kept) and a key to trust. Text
// only through textContent; the look from the theme's --desk-* tokens.
import { addressOf } from "./computers.js";

/**
 * @typedef {import("./computers.js").Computer} Computer
 * @typedef {import("./session.js").State} State
 * @typedef {import("./session.js").CredentialAsk} CredentialAsk
 * @typedef {import("./session.js").Credentials} Credentials
 * @typedef {{
 *   connect(raw: { name?: string, host?: string, port?: string, username?: string, id?: string }): unknown,
 *   remove(id: string): unknown,
 *   disconnect(): unknown,
 *   viewOnly(on: boolean): unknown,
 *   fit(on: boolean): unknown,
 * }} Actions
 */

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const home = byId("home");
  const screen = byId("screen");
  const list = byId("computers");
  const empty = byId("empty");
  const form = /** @type {HTMLFormElement} */ (byId("add"));
  const status = byId("status");
  const title = byId("title");
  const stateText = byId("state");
  const viewOnly = byId("view-only");
  const fit = byId("fit");
  const disconnect = byId("disconnect");
  const signin = /** @type {HTMLFormElement} */ (byId("signin"));
  const trust = /** @type {HTMLFormElement} */ (byId("trust"));
  const field = (/** @type {HTMLFormElement} */ f, /** @type {string} */ name) =>
    /** @type {HTMLInputElement} */ (f.elements.namedItem(name));

  /** Run an action; what goes wrong is said in the status line by the action itself. */
  const run = (/** @type {() => unknown} */ act) => {
    void Promise.resolve()
      .then(act)
      .catch(() => {});
  };
  const pressed = (/** @type {HTMLElement} */ button) =>
    button.getAttribute("aria-pressed") === "true";
  const press = (/** @type {HTMLElement} */ button, /** @type {boolean} */ on) =>
    button.setAttribute("aria-pressed", String(on));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(() =>
      actions.connect({
        host: field(form, "host").value,
        name: field(form, "name").value,
        port: field(form, "port").value,
        username: field(form, "username").value,
      }),
    );
  });
  viewOnly.addEventListener("click", () => {
    press(viewOnly, !pressed(viewOnly));
    actions.viewOnly(pressed(viewOnly));
  });
  fit.addEventListener("click", () => {
    press(fit, !pressed(fit));
    actions.fit(pressed(fit));
  });
  disconnect.addEventListener("click", () => actions.disconnect());

  /**
   * Show one question until it is answered; Escape or Cancel answer `cancelled`.
   * @template T
   * @param {HTMLFormElement} panel
   * @param {() => T} answer
   * @param {T} cancelled
   * @returns {Promise<T>}
   */
  const ask = (panel, answer, cancelled) =>
    new Promise((resolve) => {
      const done = (/** @type {T} */ value) => {
        panel.hidden = true;
        panel.removeEventListener("submit", submit);
        panel.removeEventListener("reset", reset);
        panel.removeEventListener("keydown", key);
        resolve(value);
      };
      const submit = (/** @type {Event} */ event) => {
        event.preventDefault();
        done(answer());
      };
      const reset = () => done(cancelled);
      const key = (/** @type {Event} */ event) => {
        if (/** @type {KeyboardEvent} */ (event).key !== "Escape") return;
        event.preventDefault();
        done(cancelled);
      };
      panel.addEventListener("submit", submit);
      panel.addEventListener("reset", reset);
      panel.addEventListener("keydown", key);
      panel.hidden = false;
      /** @type {HTMLElement | null} */ (
        panel.querySelector("input:not([hidden]):not(:disabled), button")
      )?.focus();
    });

  return {
    /** The element noVNC draws the remote screen into. */
    screen,

    /** @param {Computer[]} computers */
    computers(computers) {
      empty.hidden = computers.length > 0;
      list.replaceChildren(
        ...computers.map((computer) => {
          const row = doc.createElement("li");
          row.className = "computer";
          const open = doc.createElement("button");
          open.type = "button";
          open.className = "desk-row computer-open";
          open.dataset.computer = computer.id;
          const name = doc.createElement("span");
          name.className = "computer-name";
          name.textContent = computer.name;
          const where = doc.createElement("span");
          where.className = "desk-muted computer-address";
          where.textContent = computer.username
            ? `${computer.username} @ ${addressOf(computer)}`
            : addressOf(computer);
          open.append(name, where);
          open.addEventListener("click", () => run(() => actions.connect(computer)));
          const drop = doc.createElement("button");
          drop.type = "button";
          drop.className = "desk-btn desk-btn-quiet";
          drop.textContent = "Remove";
          drop.setAttribute("aria-label", `Remove ${computer.name}`);
          drop.addEventListener("click", () => run(() => actions.remove(computer.id)));
          row.append(open, drop);
          return row;
        }),
      );
    },

    /** What the session is doing: the screen while it lives, the list once it has ended. */
    phase(/** @type {State} */ state, /** @type {Computer} */ computer) {
      const live = state.phase !== "ended";
      home.hidden = live;
      screen.hidden = !live;
      title.textContent = live ? (state.desktop ?? computer.name) : "Screen Sharing";
      stateText.textContent = live ? state.detail : "";
      for (const button of [viewOnly, fit, disconnect]) button.hidden = !live;
      if (!live) {
        signin.hidden = true;
        trust.hidden = true;
      }
      status.textContent = state.detail;
    },

    /** The toggles as a new session starts. */
    toggles(/** @type {{ viewOnly: boolean, fit: boolean }} */ on) {
      press(viewOnly, on.viewOnly);
      press(fit, on.fit);
    },

    /** Put a computer, or what a command gave, in the form, and focus it. */
    fill(
      /** @type {{ host?: string, name?: string, port?: number, username?: string }} */ raw = {},
    ) {
      field(form, "host").value = raw.host ?? "";
      field(form, "name").value = raw.name ?? "";
      field(form, "port").value = raw.port === undefined ? "" : String(raw.port);
      field(form, "username").value = raw.username ?? "";
      field(form, "host").focus();
    },

    /** @param {string} text */
    status(text) {
      status.textContent = text;
    },

    /**
     * The sign-in the other Mac asks for; null when the person cancels. The password field is
     * emptied as soon as it is read.
     * @param {CredentialAsk} request
     * @returns {Promise<Credentials | null>}
     */
    askCredentials(request) {
      const user = field(signin, "username");
      const password = field(signin, "password");
      const wantsUser = request.types.includes("username");
      user.hidden = !wantsUser;
      user.disabled = !wantsUser;
      /** @type {HTMLElement} */ (user.closest("label") ?? user).hidden = !wantsUser;
      user.value = request.username ?? "";
      password.value = "";
      return ask(
        signin,
        () => {
          const answer = {
            ...(wantsUser ? { username: user.value } : {}),
            password: password.value,
          };
          password.value = "";
          return answer;
        },
        /** @type {Credentials | null} */ (null),
      ).then((answer) => {
        password.value = "";
        return answer;
      });
    },

    /**
     * Whether to trust the key the other computer showed, by its fingerprint.
     * @param {string} fingerprint
     */
    askTrust(fingerprint) {
      /** @type {HTMLElement} */ (trust.querySelector(".fingerprint")).textContent = fingerprint;
      return ask(trust, () => true, false);
    },
  };
}
