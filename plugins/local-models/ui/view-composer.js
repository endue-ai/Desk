// Where the person writes: a field that grows with the text, Enter to send and Shift+Enter for a
// new line, and one button that sends or, while an answer streams, stops it.
import { compact, contextUse } from "./context.js";
import { fill, h, icon } from "./dom.js";
import { editLastQuestion } from "./message.js";
import { attachView } from "./view-attach.js";

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
  const ring = h("span.lm-ctx-ring");
  const meterText = h("span.lm-ctx-text");
  const meter = h("div.lm-ctx", { role: "meter", "aria-label": "Context used" }, ring, meterText);
  const tools = h("div.lm-composer-tools");
  const box = h("div.lm-composer");
  const attach = attachView(app, { field, box, onChange: () => drawButton() });
  tools.append(attach.button);
  box.append(
    attach.tray,
    field,
    h("div.lm-composer-bar", null, tools, h("div.lm-composer-spacer"), hint, meter, send),
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
    if (!text.trim() && !attach.count) return;
    field.value = "";
    grow();
    void app.send(text, attach.take());
  }

  field.addEventListener("input", () => {
    grow();
    drawButton();
    drawMeter();
  });
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowUp" && !field.value && editLastQuestion(app)) {
      e.preventDefault();
    } else if (e.key === "Escape" && S.get().generating) {
      e.preventDefault();
      app.stop();
    }
  });
  send.addEventListener("click", submit);
  box.addEventListener("click", (e) => {
    if (e.target === box) field.focus();
  });

  function drawMeter() {
    const { used, limit, exact } = contextUse(S.get(), field.value);
    const share = limit ? Math.min(1, used / limit) : 0;
    meter.hidden = !used && !limit;
    meter.dataset.level = share > 0.9 ? "full" : share > 0.7 ? "high" : "";
    ring.style.setProperty("--lm-share", `${Math.round(share * 100)}%`);
    fill(meterText, limit ? `${compact(used)} / ${compact(limit)}` : `${compact(used)} tokens`);
    meter.title = `${exact ? "" : "About "}${used.toLocaleString()} tokens${limit ? ` of the ${limit.toLocaleString()} the model holds` : ""}${share > 0.9 ? ". Older messages may fall out of what the model sees." : ""}`;
    if (limit) {
      meter.setAttribute("aria-valuenow", String(used));
      meter.setAttribute("aria-valuemax", String(limit));
    }
  }

  function drawButton() {
    const { generating, selected, thread, preparing } = S.get();
    const busy = Boolean(generating);
    const model = thread?.model ?? selected;
    fill(send, icon(busy ? "stop" : "send"));
    send.title = busy ? "Stop (Esc)" : "Send (Enter)";
    send.setAttribute("aria-label", busy ? "Stop" : "Send");
    send.dataset.busy = busy ? "1" : "";
    /** @type {HTMLButtonElement} */ (send).disabled =
      !busy && (!model || Boolean(preparing) || (!field.value.trim() && !attach.count));
    box.dataset.busy = busy ? "1" : "";
    fill(hint, preparing ? [h("span.lm-spinner"), preparing] : busy ? "Writing… Esc to stop" : "");
  }

  S.on(["generating", "selected", "thread", "preparing"], drawButton);
  S.on(["generating", "selected", "thread", "models", "servers"], drawMeter);
  S.onSignal("settings", drawMeter);
  drawButton();
  drawMeter();
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
