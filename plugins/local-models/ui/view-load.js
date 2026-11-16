// A model file's load settings, before the built-in engine runs it: context length, GPU layers,
// CPU threads, flash attention, the cache type, keeping it in memory, and what all that needs in
// memory against what this computer has. "Load" runs it; the settings are kept for that file.
import { numberField, segmented, slider, toggle } from "./controls.js";
import { fill, h, icon } from "./dom.js";
import { FIT_WORDS } from "./memory.js";
import { formatBytes, formatContext } from "./models.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./library.js").LocalModel} LocalModel
 * @typedef {import("./engine.js").LoadConfig} LoadConfig
 */

/** The memory a load needs, as a bar against what there is. @param {App} app @param {LocalModel} m @param {LoadConfig} c */
export function fitBar(app, m, c) {
  const { need, fit } = app.local.fitFor(m, c);
  const mem = app.S.get().memory;
  const usable = mem ? (mem.kind === "unified" ? mem.total * 0.75 : (mem.gpu ?? mem.total)) : 0;
  const share = usable ? Math.min(1, need / usable) : 0;
  return h(
    "div.lm-fit",
    { dataset: { fit } },
    h(
      "div.lm-fit-row",
      null,
      h(
        "span.lm-fit-word",
        null,
        icon(fit === "fits" ? "check" : fit === "unknown" ? "cpu" : "bolt"),
        FIT_WORDS[fit] || "Memory needed",
      ),
      h(
        "span.lm-fit-num",
        null,
        `≈ ${formatBytes(need)}${usable ? ` of ${formatBytes(usable)}` : ""}`,
      ),
    ),
    usable
      ? h(
          "div.desk-progress.lm-fit-bar",
          null,
          h("span", { style: { width: `${Math.round(share * 100)}%` } }),
        )
      : null,
  );
}

/** @param {App} app @param {LocalModel} m @param {{ onDone?: () => void }} [o] */
export function loadPanel(app, m, o = {}) {
  let c = app.local.configFor(m);
  const maxCtx = m.info?.ctx ?? 32768;
  const layers = m.info?.layers ?? 0;
  const fitHost = h("div");
  const drawFit = () => fill(fitHost, fitBar(app, m, c));
  /** @param {Partial<LoadConfig>} patch */
  const set = (patch) => {
    c = { ...c, ...patch };
    drawFit();
  };
  const ctxSteps = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144].filter(
    (x) => x <= maxCtx,
  );
  const button = h(
    "button.desk-btn.desk-btn-primary.lm-load-btn",
    {
      type: "button",
      onClick: async () => {
        button.setAttribute("disabled", "");
        fill(button, h("span.lm-spinner"), "Loading…");
        await app.local.saveConfig(m.path, c);
        await app.local.load(m, c);
        o.onDone?.();
      },
    },
    icon("play"),
    "Load model",
  );
  /** Draw the panel again with the settings chosen (the segmented choices show their state). */
  const redraw = () => {
    void app.local.saveConfig(m.path, c);
    const host = button.closest(".lm-load")?.parentElement;
    if (host) fill(host, loadPanel(app, m, o));
  };
  drawFit();
  return h(
    "div.lm-load",
    null,
    h(
      "div.lm-ctl",
      null,
      h(
        "div.lm-ctl-row",
        null,
        h("label.lm-ctl-label", null, "Context length"),
        h("span.lm-ctl-value", null, `${formatContext(c.ctx)} of ${formatContext(maxCtx)}`),
      ),
      segmented({
        label: "Context length",
        value: String(c.ctx),
        options: (ctxSteps.length ? ctxSteps : [maxCtx]).map((x) => ({
          value: String(x),
          label: formatContext(x),
        })),
        onChange: (v) => {
          set({ ctx: Number(v) });
          redraw();
        },
      }),
      h(
        "div.lm-ctl-hint",
        null,
        "How much of the conversation the model sees. Longer needs more memory.",
      ),
    ),
    layers
      ? slider({
          label: "GPU layers",
          hint: `Layers run on the GPU, of ${layers}; the rest on the CPU, slower`,
          min: 0,
          max: layers,
          step: 1,
          digits: 0,
          value: Math.min(c.gpuLayers ?? layers, layers),
          fallback: layers,
          onChange: (v) => set({ gpuLayers: v ?? layers }),
        })
      : null,
    numberField({
      label: "CPU threads",
      hint: "Empty lets the engine choose",
      value: c.threads,
      min: 1,
      max: 256,
      onChange: (v) => set({ threads: v }),
    }),
    h(
      "div.lm-ctl",
      null,
      h("div.lm-ctl-row", null, h("label.lm-ctl-label", null, "Cache type")),
      segmented({
        label: "Cache type",
        value: c.cacheType ?? "f16",
        options: [
          { value: "f16", label: "F16" },
          { value: "q8_0", label: "Q8" },
          { value: "q4_0", label: "Q4" },
        ],
        onChange: (v) => {
          set({ cacheType: v });
          redraw();
        },
      }),
      h("div.lm-ctl-hint", null, "A smaller cache fits a longer context, at a little quality."),
    ),
    toggle({
      label: "Flash attention",
      hint: "Faster and leaner on most GPUs",
      checked: c.flashAttention !== false,
      onChange: (v) => set({ flashAttention: v }),
    }),
    toggle({
      label: "Keep in memory",
      hint: "Never paged out (mlock)",
      checked: Boolean(c.mlock),
      onChange: (v) => set({ mlock: v }),
    }),
    toggle({
      label: "Map the file",
      hint: "Starts faster; off reads it all in (mmap)",
      checked: c.mmap !== false,
      onChange: (v) => set({ mmap: v }),
    }),
    m.projector
      ? h(
          "div.lm-ctl-hint",
          null,
          icon("eye"),
          " A vision projector beside it loads too, for images.",
        )
      : null,
    fitHost,
    button,
  );
}
