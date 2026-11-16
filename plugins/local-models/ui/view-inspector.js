// The inspector beside the chat (Mod+.): the chat's preset, system prompt, sampling, context,
// reasoning, output format and stop strings. Changes apply to the next answer of the open chat;
// "Use for new chats" keeps them as the defaults.
import { chips, section, segmented, toggle } from "./controls.js";
import { fill, h, icon, iconButton } from "./dom.js";
import { formatContext, modelKey } from "./models.js";
import { clean, estimateTokens, matches, settingsOf } from "./presets.js";
import { samplingSection } from "./sampling.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./threads.js").Thread} Thread
 */

const CONTEXTS = [2048, 4096, 8192, 16384, 32768, 65536, 131072];

/** @param {App} app */
export function inspectorView(app) {
  const { S } = app;
  const body = h("div.lm-insp-body");
  const el = h(
    "aside.lm-insp",
    { "aria-label": "Chat settings" },
    h(
      "header.lm-insp-head",
      null,
      icon("sliders"),
      h("h2.lm-insp-title", null, "Chat settings"),
      h("div.lm-head-spacer"),
      iconButton("x", "Hide the settings (Mod+.)", () => {
        S.set({ inspector: false });
        app.savePrefs();
      }),
    ),
    body,
  );

  /** The open chat, made when there is none so settings can be set before the first message. */
  const thread = () => S.get().thread ?? app.newChat();

  /** Change the chat's settings and save it. @param {(t: Thread) => void} change */
  function edit(change, redraw = false) {
    const t = thread();
    change(t);
    if (!matches({ system: t.system, params: t.params }, app.presets.get(t.preset)))
      t.preset = undefined;
    if (Object.keys(t.nodes).length) app.persist(t);
    if (redraw) draw();
    else drawHead();
    S.signal("settings", t);
  }

  /** @param {keyof import("./chat-types.js").Sampling} key @param {unknown} value */
  const setParam = (key, value) =>
    edit((t) => {
      t.params = clean({ ...t.params, [key]: value });
    });

  const presetSelect = /** @type {HTMLSelectElement} */ (
    h("select.desk-field.lm-preset", { "aria-label": "Preset" })
  );
  presetSelect.addEventListener("change", () => {
    const preset = app.presets.get(presetSelect.value);
    if (!preset) return;
    edit((t) => Object.assign(t, settingsOf(preset)), true);
  });

  function drawHead() {
    const t = S.get().thread;
    const current = t?.preset;
    fill(
      presetSelect,
      h("option", { value: "", disabled: true, selected: !current }, current ? "" : "Custom"),
      app.presets
        .all()
        .map((p) =>
          h(
            "option",
            { value: p.id, selected: p.id === current },
            p.builtIn ? p.name : `${p.name} (yours)`,
          ),
        ),
    );
  }

  async function savePreset() {
    const t = S.get().thread;
    if (!t) return;
    const name = nameField.value.trim();
    if (!name) {
      nameField.focus();
      return;
    }
    const preset = await app.presets.save(name, {
      system: t.system,
      params: t.params,
      think: t.think,
    });
    t.preset = preset.id;
    nameField.value = "";
    app.toast(`Saved the preset “${preset.name}”.`, "success");
    draw();
  }
  const nameField = /** @type {HTMLInputElement} */ (
    h("input.desk-field", { placeholder: "Name a new preset", "aria-label": "Preset name" })
  );
  nameField.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void savePreset();
  });

  function draw() {
    const t = S.get().thread;
    const p = t?.params ?? {};
    const key = t?.model ?? S.get().selected;
    const model = S.get().models.find((m) => modelKey(m) === key);
    const server = S.get().servers.find((s) => key?.startsWith(`${s.id}|`));
    const reasons = model?.caps.includes("reasoning");
    const max = model?.ctx ?? 131072;
    const system = /** @type {HTMLTextAreaElement} */ (
      h("textarea.desk-field.lm-system", {
        rows: 5,
        placeholder: "You are a helpful assistant…",
        "aria-label": "System prompt",
      })
    );
    system.value = t?.system ?? "";
    const sysCount = h("span.lm-ctl-value", null, `≈ ${estimateTokens(system.value)} tokens`);
    system.addEventListener("input", () =>
      fill(sysCount, `≈ ${estimateTokens(system.value)} tokens`),
    );
    system.addEventListener("change", () =>
      edit((x) => {
        x.system = system.value;
      }),
    );
    const formatMode = !t?.format ? "text" : t.format === "json" ? "json" : "schema";
    const schema = /** @type {HTMLTextAreaElement} */ (
      h("textarea.desk-field.lm-schema", {
        rows: 6,
        spellcheck: "false",
        "aria-label": "JSON schema",
        placeholder: '{ "type": "object", "properties": { … } }',
      })
    );
    schema.value = typeof t?.format === "object" ? JSON.stringify(t.format, null, 2) : "";
    const schemaNote = h("div.lm-ctl-hint");
    schema.addEventListener("change", () => {
      try {
        const parsed = JSON.parse(schema.value);
        fill(schemaNote, "");
        edit((x) => {
          x.format = parsed;
        });
      } catch (e) {
        fill(schemaNote, h("span.lm-bad", null, `Not JSON: ${e instanceof Error ? e.message : e}`));
      }
    });
    fill(
      body,
      section("Preset", "bolt", [
        h(
          "div.lm-ctl",
          null,
          presetSelect,
          h(
            "div.lm-ctl-hint",
            null,
            app.presets.get(t?.preset)?.description ?? "These settings differ from every preset.",
          ),
        ),
        h(
          "div.lm-ctl-row.lm-save-preset",
          null,
          nameField,
          h("button.desk-btn", { type: "button", onClick: () => void savePreset() }, "Save"),
        ),
      ]),
      section("System prompt", "chat", [
        h(
          "div.lm-ctl",
          null,
          system,
          h(
            "div.lm-ctl-row",
            null,
            h("span.lm-ctl-hint", null, "Sent before every message of this chat"),
            sysCount,
          ),
        ),
      ]),
      samplingSection(p, setParam),
      section("Context", "book", [
        server?.kind === "ollama"
          ? h(
              "div.lm-ctl",
              null,
              h(
                "div.lm-ctl-row",
                null,
                h("label.lm-ctl-label", null, "Context length"),
                h(
                  "span.lm-ctl-value",
                  null,
                  p.contextLength ? formatContext(p.contextLength) : "Default",
                ),
              ),
              segmented({
                label: "Context length",
                value: String(p.contextLength ?? ""),
                options: [
                  { value: "", label: "Auto" },
                  ...CONTEXTS.filter((c) => c <= max).map((c) => ({
                    value: String(c),
                    label: formatContext(c),
                  })),
                ],
                onChange: (v) =>
                  edit((x) => {
                    x.params = clean({ ...x.params, contextLength: v ? Number(v) : undefined });
                  }, true),
              }),
              h(
                "div.lm-ctl-hint",
                null,
                model?.ctx
                  ? `The model was trained on ${formatContext(model.ctx)} tokens. A longer context needs more memory.`
                  : "A longer context needs more memory.",
              ),
            )
          : h(
              "div.lm-ctl-hint",
              null,
              `This server sets the context length when it loads the model${server?.ctx ? `: ${formatContext(server.ctx)}` : ""}.`,
            ),
      ]),
      reasons
        ? section("Reasoning", "lightbulb", [
            toggle({
              label: "Let the model think",
              hint: "Reasoning first, folded above the answer",
              checked: t?.think !== false,
              onChange: (v) =>
                edit((x) => {
                  x.think = v;
                }),
            }),
          ])
        : null,
      section("Output", "code", [
        segmented({
          label: "Output",
          value: formatMode,
          options: [
            { value: "text", label: "Text" },
            { value: "json", label: "JSON" },
            { value: "schema", label: "JSON schema" },
          ],
          onChange: (v) =>
            edit((x) => {
              x.format =
                v === "text"
                  ? undefined
                  : v === "json"
                    ? "json"
                    : {
                        type: "object",
                        properties: { answer: { type: "string" } },
                        required: ["answer"],
                      };
            }, true),
        }),
        formatMode === "schema" ? h("div.lm-ctl", null, schema, schemaNote) : null,
        h(
          "div.lm-ctl-hint",
          null,
          formatMode === "text"
            ? "Answers as the model writes them"
            : "The server holds the model to valid JSON",
        ),
      ]),
      section(
        "Stop strings",
        "stop",
        [
          chips({
            label: "Stop at",
            hint: "The answer ends where one of these appears (\\n for a new line)",
            values: p.stop ?? [],
            onChange: (v) => setParam("stop", v),
          }),
        ],
        { open: Boolean(p.stop?.length) },
      ),
      h(
        "div.lm-insp-foot",
        null,
        h(
          "button.desk-btn.desk-btn-quiet",
          { type: "button", onClick: () => void app.saveDefaults(thread()) },
          icon("check"),
          "Use for new chats",
        ),
        h(
          "button.desk-btn.desk-btn-quiet",
          {
            type: "button",
            onClick: () =>
              edit(
                (x) =>
                  Object.assign(x, {
                    system: "",
                    params: {},
                    preset: "balanced",
                    format: undefined,
                    think: undefined,
                  }),
                true,
              ),
          },
          icon("refresh"),
          "Reset",
        ),
      ),
    );
    drawHead();
  }

  /** @type {string | undefined} */
  let drawnFor;
  S.on(["thread", "models", "selected"], (s, changed) => {
    if (!s.inspector) return;
    // A thread touched by its answer keeps the fields as they are; another thread redraws them.
    if (
      changed.has("thread") &&
      s.thread?.id === drawnFor &&
      !changed.has("models") &&
      !changed.has("selected")
    )
      return;
    drawnFor = s.thread?.id;
    draw();
  });
  S.on(["inspector"], (s) => {
    el.hidden = !s.inspector;
    if (s.inspector) draw();
  });
  el.hidden = !S.get().inspector;
  if (S.get().inspector) draw();
  return { el, draw };
}
