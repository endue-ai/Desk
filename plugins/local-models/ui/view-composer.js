// Where the person writes: a field that grows with the text, Enter to send and Shift+Enter for a
// new line, and one button that sends or, while an answer streams, stops it.
import { fill, h, icon } from "./dom.js";

/** @typedef {import("./app.js").App} App */

/** @param {App} app */
export function composerView(app) {
  const { S } = app;
  const field = /** @type {HTMLTextAreaElement} */ (
    h("textarea.desk-field.lm-input", {
      rows: 1,
      placeholder: "Message the model…",
      "aria-label": "Message",
    })
  );
  const send = h("button.desk-btn.desk-btn-primary.lm-send", { type: "button" });
  const hint = h("div.lm-composer-hint");
  const tools = h("div.lm-composer-tools");
  const box = h(
    "div.lm-composer",
    null,
    field,
    h("div.lm-composer-bar", null, tools, h("div.lm-composer-spacer"), hint, send),
  );
  const el = h(
    "div.lm-composer-wrap",
    null,
    box,
    h("div.lm-footnote", null, "Answers come from a model on this computer and can be wrong."),
  );

  const grow = () => {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 280)}px`;
  };

  function submit() {
    if (S.get().generating) {
      app.stop();
      return;
    }
    const text = field.value;
    if (!text.trim()) return;
    field.value = "";
    grow();
    void app.send(text);
  }

  field.addEventListener("input", () => {
    grow();
    drawButton();
  });
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && S.get().generating) {
      e.preventDefault();
      app.stop();
    }
  });
  send.addEventListener("click", submit);
  box.addEventListener("click", (e) => {
    if (e.target === box) field.focus();
  });

  function drawButton() {
    const { generating, selected, thread } = S.get();
    const busy = Boolean(generating);
    const model = thread?.model ?? selected;
    fill(send, icon(busy ? "stop" : "send"));
    send.title = busy ? "Stop (Esc)" : "Send (Enter)";
    send.setAttribute("aria-label", busy ? "Stop" : "Send");
    send.dataset.busy = busy ? "1" : "";
    /** @type {HTMLButtonElement} */ (send).disabled = !busy && (!model || !field.value.trim());
    box.dataset.busy = busy ? "1" : "";
    fill(hint, busy ? "Writing… Esc to stop" : "");
  }

  S.on(["generating", "selected", "thread"], drawButton);
  drawButton();
  return {
    el,
    field,
    tools,
    focus: () => field.focus(),
    /** @param {string} text */
    setText(text) {
      field.value = text;
      grow();
      drawButton();
      field.focus();
    },
  };
}
