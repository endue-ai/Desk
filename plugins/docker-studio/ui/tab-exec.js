// The Exec tab: a shell session in a running container, without a terminal (`docker exec -i`), as
// a console of commands and their output. After each command the shell prints a marker with its
// exit code and folder, so each block knows how it ended and the prompt where it is. Programs that
// need a terminal (editors, top) belong in Open a terminal, which the tab offers.

import { button, h, icon } from "./dom.js";
import { objectRef } from "./refs.js";

/** @typedef {import("./studio.js").App} App */

const RS = "\u001e";
/** The line the shell writes after each command: RS code cwd RS. */
const MARKER = new RegExp(`^${RS}(\\d+) (.*)${RS}$`);
const PROBE = `printf '\\n\\036%s %s\\036\\n' "$?" "$PWD"\n`;
const QUICK = ["ls -la", "env", "ps aux", "df -h", "cat /etc/os-release", "whoami"];

/** @param {App} app @param {import("./parse.js").Container} c */
export function createExecView(app, c) {
  /** @type {import("./run.js").StreamHandle | null} */
  let session = null;
  let cwd = c.workdir || "/";
  /** @type {{ el: HTMLElement, out: HTMLElement, status: HTMLElement } | null} */
  let block = null;
  /** @type {string[]} */
  const history = app.prefs(`exec:${c.id}`, { history: /** @type {string[]} */ ([]) }).history;
  let at = history.length;
  let held = "";

  const transcript = h("div.console-out", {
    role: "log",
    "aria-label": `Shell of ${c.name}`,
    tabindex: "0",
  });
  const prompt = h("span.console-prompt");
  const input = /** @type {HTMLInputElement} */ (
    h("input.desk-field.console-input", {
      type: "text",
      spellcheck: "false",
      autocomplete: "off",
      "aria-label": "Command",
      placeholder: "Type a command and press Enter",
    })
  );
  const state = h("span.console-state");
  const element = h(
    "section.exec-view",
    null,
    h(
      "div.exec-bar",
      null,
      state,
      h("span.grow"),
      ...QUICK.map((q) =>
        h("button.desk-btn.desk-btn-quiet.chip", { type: "button", onClick: () => send(q) }, q),
      ),
      button({
        label: "Clear",
        icon: "x",
        hideLabel: true,
        onClick: () => transcript.replaceChildren(),
      }),
      button({
        label: "Open a terminal",
        icon: "terminal",
        kind: "desk-btn-quiet",
        onClick: () => void app.act.shell(c),
      }),
    ),
    transcript,
    h(
      "form.console-line",
      {
        onSubmit: (/** @type {Event} */ e) => {
          e.preventDefault();
          send(input.value);
        },
      },
      prompt,
      input,
    ),
  );

  const drawPrompt = () => {
    prompt.textContent = `${c.name.slice(0, 18)}:${cwd} $`;
  };

  const heard = (/** @type {"stdout" | "stderr"} */ stream, /** @type {string} */ line) => {
    const done = MARKER.exec(line);
    if (done) {
      cwd = done[2] || cwd;
      drawPrompt();
      if (block) {
        const last = block.out.lastElementChild;
        if (last && last.textContent === "") last.remove();
        const code = Number(done[1]);
        block.status.replaceChildren(
          code === 0 ? icon("check", 12) : icon("x", 12),
          code === 0 ? "" : ` exit ${code}`,
        );
        block.el.classList.add(code === 0 ? "ok" : "failed");
        block.el.classList.remove("running");
        block = null;
      }
      return;
    }
    if (!block) return;
    block.out.append(h(`div.out-line${stream === "stderr" ? ".err" : ""}`, null, line));
    transcript.scrollTop = transcript.scrollHeight;
  };

  const connect = async () => {
    if (c.state !== "running") {
      state.replaceChildren(icon("info", 13), "Start the container to run commands in it.");
      input.disabled = true;
      return;
    }
    state.replaceChildren(h("span.spinner"), "Connecting…");
    try {
      session = await app.runner.stream(
        ["exec", "--interactive", "--", objectRef(c.id), app.settings.shell],
        {
          onLine: heard,
          onExit: (outcome) => {
            session = null;
            state.replaceChildren(
              icon("alert", 13),
              `The shell ended${outcome.code !== null ? ` (${outcome.code})` : ""}. `,
              button({
                label: "Reconnect",
                kind: "desk-btn-quiet link",
                onClick: () => void connect(),
              }),
            );
            input.disabled = true;
          },
        },
      );
      await session.write(PROBE);
      state.replaceChildren(h("span.live-dot"), `${app.settings.shell} in ${c.name}`);
      input.disabled = false;
      drawPrompt();
      input.focus();
    } catch (error) {
      state.replaceChildren(
        icon("alert", 13),
        String(/** @type {any} */ (error)?.message ?? error),
      );
    }
  };

  const send = (/** @type {string} */ text) => {
    const cmd = text.trim();
    if (!cmd || !session) return;
    if (cmd === "clear") {
      transcript.replaceChildren();
      input.value = "";
      return;
    }
    if (history.at(-1) !== cmd) history.push(cmd);
    if (history.length > 100) history.shift();
    at = history.length;
    const status = h("span.block-status", null, h("span.spinner"));
    const out = h("div.block-out");
    const el = h(
      "div.block.running",
      null,
      h("div.block-cmd", null, h("span.muted", null, `${cwd} $ `), h("b", null, cmd), status),
      out,
    );
    transcript.append(el);
    block = { el, out, status };
    input.value = "";
    transcript.scrollTop = transcript.scrollHeight;
    void session.write(`${cmd}\n${PROBE}`);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && at > 0) {
      if (at === history.length) held = input.value;
      input.value = history[--at] ?? "";
    } else if (e.key === "ArrowDown" && at < history.length) {
      at += 1;
      input.value = at === history.length ? held : (history[at] ?? "");
    } else return;
    e.preventDefault();
  });

  drawPrompt();
  void connect();
  return {
    element,
    dispose() {
      void session?.write("", true).catch(() => {});
      void session?.stop();
      session = null;
    },
  };
}
