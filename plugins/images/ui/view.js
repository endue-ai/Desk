// The DOM for the images plugin: the header (name, format, place in the folder), the toolbar, one
// or two panes on the stage, the details panel and a status live region. It keeps the zoom, pan and
// turn (viewer.js), handles the keys and the pointer, and asks the controller for the rest. Chords
// the desk binds (Mod+S, Mod+O, Mod+W, Mod+K ...) are never prevented.
import { createViewer, fitOf, fromOrientation, PAN, transform, turned } from "./viewer.js";

/**
 * @typedef {import("./images.js").ImagesState} ImagesState
 * @typedef {import("./details.js").ImageModel} ImageModel
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {{ width: number, height: number }} Size
 * @typedef {{ measure?: (el: HTMLElement) => Size, paint?: (canvas: HTMLCanvasElement, pixels: NonNullable<ImageModel["pixels"]>) => void }} Options
 * @typedef {{ el: HTMLElement, frame: HTMLElement, caption: HTMLElement, key: unknown, media: HTMLElement | null, model: ImageModel | null, natural: Size | null }} Pane
 */

/**
 * @param {Document} doc
 * @param {Act} act
 * @param {Options} [options]
 */
export function createView(doc, act, options = {}) {
  const measure = options.measure ?? ((el) => ({ width: el.clientWidth, height: el.clientHeight }));
  const paint = options.paint ?? (() => {});
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const stage = byId("stage");
  const zoomLevel = byId("zoom-level");
  const pick = /** @type {HTMLSelectElement} */ (byId("compare-with"));
  const picker = byId("compare-pick");
  const details = byId("details");
  const status = byId("status");
  /** @type {(id: string) => Pane} */
  const paneOf = (id) => {
    const el = byId(id);
    const frame = /** @type {HTMLElement} */ (el.querySelector(".frame"));
    const caption = /** @type {HTMLElement} */ (el.querySelector("figcaption"));
    return { el, frame, caption, key: null, media: null, model: null, natural: null };
  };
  const a = paneOf("pane-a");
  const b = paneOf("pane-b");
  const viewer = createViewer();
  /** @type {ImagesState} */
  let state = { image: null, partner: null, position: null, choices: [] };
  /** @type {string | null} */
  let path = null;

  const say = (/** @type {string} */ text) => {
    status.textContent = text;
  };

  /** The size a pane lays out: the header's, else the webview's once it decoded the image. */
  const sizeOf = (/** @type {Pane} */ pane) => {
    const m = pane.model;
    if (m?.pixels) return { width: m.pixels.width, height: m.pixels.height };
    if (m?.width && m.height) return { width: m.width, height: m.height };
    return pane.natural ?? { width: 300, height: 150 };
  };
  const turnOf = (/** @type {Pane} */ pane) =>
    pane === a ? viewer : fromOrientation(pane.model?.orientation ?? 1);
  const comparing = () => !!state.partner && !!state.image;

  /** Each shown pane's size, its image's turned size and the scale that fits it. */
  const geometry = () => {
    const whole = measure(stage);
    const box = { width: comparing() ? whole.width / 2 : whole.width, height: whole.height };
    return [a, ...(comparing() ? [b] : [])]
      .filter((p) => p.model && p.model.kind !== "details")
      .map((pane) => {
        const size = turned(sizeOf(pane), turnOf(pane).rotation);
        return { pane, box, size, fit: fitOf(box, size) };
      });
  };
  const primaryFit = () => geometry()[0]?.fit ?? 1;
  const zoomedIn = () =>
    geometry().some(({ box, size, fit }) => {
      const s = viewer.scale(fit);
      return size.width * s > box.width + 0.5 || size.height * s > box.height + 0.5;
    });

  /** Apply the zoom, pan and turn to every shown pane. */
  const layout = () => {
    const panes = geometry();
    let x = 0;
    let y = 0;
    for (const { box, size, fit } of panes) {
      const s = viewer.scale(fit);
      x = Math.max(x, (size.width * s - box.width) / 2);
      y = Math.max(y, (size.height * s - box.height) / 2);
    }
    viewer.clamp({ x: Math.max(0, x), y: Math.max(0, y) });
    for (const { pane, fit } of panes) {
      const media = pane.media;
      if (!media) continue;
      const s = viewer.scale(fit);
      const { width, height } = sizeOf(pane);
      Object.assign(media.style, {
        width: `${width}px`,
        height: `${height}px`,
        marginLeft: `${-width / 2}px`,
        marginTop: `${-height / 2}px`,
        imageRendering: s >= 2 ? "pixelated" : "auto",
      });
      media.style.transform = transform(viewer, s, turnOf(pane));
    }
    const first = panes[0];
    zoomLevel.textContent = first ? `${Math.round(viewer.scale(first.fit) * 100)}%` : "";
    stage.dataset.zoomed = zoomedIn() ? "in" : "out";
  };

  /** Put a model's image (or its details card) into a pane, keeping what is already there. */
  const show = (/** @type {Pane} */ pane, /** @type {ImageModel | null} */ model) => {
    pane.model = model;
    pane.caption.textContent = model && comparing() ? model.name : "";
    const key = model ? (model.kind === "details" ? model : (model.src ?? model.pixels)) : null;
    if (key === pane.key) return;
    pane.key = key;
    pane.natural = null;
    pane.media = null;
    pane.frame.replaceChildren();
    if (!model) return;
    if (model.kind === "details") {
      const card = doc.createElement("div");
      card.className = "notice";
      const title = doc.createElement("h2");
      title.textContent = model.name;
      const facts = doc.createElement("p");
      facts.textContent = `${model.format} · ${model.details.find((r) => r.label === "File size")?.value ?? ""}`;
      const reason = doc.createElement("p");
      reason.className = "reason";
      reason.textContent = model.reason ?? "";
      card.append(title, facts, reason);
      pane.frame.append(card);
      return;
    }
    if (model.kind === "pixels" && model.pixels) {
      const canvas = doc.createElement("canvas");
      canvas.width = model.pixels.width;
      canvas.height = model.pixels.height;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", model.name);
      paint(canvas, model.pixels);
      pane.media = canvas;
    } else {
      const img = doc.createElement("img");
      img.alt = model.name;
      img.decoding = "async";
      img.draggable = false;
      img.addEventListener("error", () => act("failed", model));
      img.addEventListener("load", () => {
        if (model.width && model.height) return;
        pane.natural = { width: img.naturalWidth || 512, height: img.naturalHeight || 512 };
        act("loaded", model, pane.natural);
        layout();
      });
      img.src = model.src ?? "";
      pane.media = img;
    }
    pane.media.classList.add("media");
    pane.frame.append(pane.media);
  };

  /** The details panel: one term and description per row. */
  const describe = (/** @type {ImageModel | null} */ model) => {
    const list = byId("details-list");
    list.replaceChildren(
      ...(model?.details ?? []).flatMap(({ label, value }) => {
        const dt = doc.createElement("dt");
        dt.textContent = label;
        const dd = doc.createElement("dd");
        dd.textContent = value;
        return [dt, dd];
      }),
    );
    if (model?.kind === "details") {
      const dt = doc.createElement("dt");
      dt.textContent = "Why";
      const dd = doc.createElement("dd");
      dd.textContent = model.reason ?? "";
      list.append(dt, dd);
    }
  };

  /** The compare picker's options: the other open images and the folder's. */
  const offer = () => {
    const chosen = state.partner?.path ?? "";
    const first = /** @type {HTMLOptionElement} */ (pick.options[0]);
    pick.replaceChildren(
      first,
      ...state.choices.map(({ path: value, name }) => {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = name;
        return option;
      }),
    );
    pick.value = chosen;
  };

  const controls = () => {
    const image = state.image;
    const visual = !!image && image.kind !== "details";
    /** @type {HTMLButtonElement} */ for (const id of [
      "zoom-out",
      "zoom-in",
      "zoom-fit",
      "zoom-actual",
      "rotate-left",
      "rotate-right",
      "flip",
    ])
      byId(id).disabled = !visual;
    const walk = !!state.position && state.position.count > 1;
    /** @type {HTMLButtonElement} */ (byId("previous")).disabled =
      !walk || state.position?.index === 1;
    /** @type {HTMLButtonElement} */ (byId("next")).disabled =
      !walk || state.position?.index === state.position?.count;
    /** @type {HTMLButtonElement} */ (byId("compare")).disabled = !image;
    byId("compare").setAttribute("aria-pressed", String(comparing()));
    byId("flip").setAttribute("aria-pressed", String(viewer.flipped));
  };

  /** Re-lay out after a change to the zoom, the pan or the turn. */
  const changed = () => {
    layout();
    controls();
  };
  const zoom = (/** @type {1 | -1} */ direction) => {
    viewer.step(direction, primaryFit());
    changed();
  };
  const actual = () => {
    viewer.set(1, primaryFit());
    changed();
  };
  const fitAll = () => {
    viewer.fit();
    changed();
  };
  const rotate = (/** @type {number} */ degrees) => {
    viewer.rotate(degrees);
    viewer.fit();
    changed();
    say(`Turned to ${viewer.rotation}°.`);
  };
  const leave = () => {
    picker.hidden = true;
    act("compare", null);
  };

  const buttons = /** @type {Record<string, () => unknown>} */ ({
    previous: () => act("previous"),
    next: () => act("next"),
    "zoom-out": () => zoom(-1),
    "zoom-in": () => zoom(1),
    "zoom-fit": fitAll,
    "zoom-actual": actual,
    "rotate-left": () => rotate(-90),
    "rotate-right": () => rotate(90),
    flip: () => {
      viewer.flip();
      changed();
      say(viewer.flipped ? "Flipped." : "Not flipped.");
    },
    compare: () => {
      if (comparing()) return leave();
      picker.hidden = false;
      pick.focus();
    },
    "details-toggle": () => {
      details.hidden = !details.hidden;
      byId("details-toggle").setAttribute("aria-expanded", String(!details.hidden));
      layout();
    },
  });
  for (const [id, run] of Object.entries(buttons)) byId(id).addEventListener("click", () => run());
  pick.addEventListener("change", () => act("compare", pick.value || null));

  doc.addEventListener("keydown", (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    // A stage no longer in the document belongs to a page that was replaced (the tests do that).
    if (!stage.isConnected || event.defaultPrevented) return;
    if (target?.tagName === "SELECT" || target?.tagName === "INPUT") return;
    const mod = event.metaKey || event.ctrlKey;
    const { key } = event;
    let handled = true;
    if (mod && !event.altKey) {
      if (key === "=" || key === "+") zoom(1);
      else if (key === "-" || key === "_") zoom(-1);
      else if (key === "0") fitAll();
      else handled = false;
    } else if (event.altKey || !state.image) handled = false;
    else if (key === "ArrowLeft" || key === "ArrowRight") {
      const sign = key === "ArrowLeft" ? 1 : -1;
      if (zoomedIn()) {
        viewer.pan(sign * PAN, 0);
        layout();
      } else act(sign > 0 ? "previous" : "next");
    } else if (key === "ArrowUp" || key === "ArrowDown") {
      const sign = key === "ArrowUp" ? 1 : -1;
      if (zoomedIn()) {
        viewer.pan(0, sign * PAN);
        layout();
      } else if (state.image.slice) act("slice", sign);
      else handled = false;
    } else if (key === "PageUp") act("previous");
    else if (key === "PageDown") act("next");
    else if (key === "Home") act("first");
    else if (key === "End") act("last");
    else if (key === "Escape" && (comparing() || !picker.hidden)) leave();
    else handled = false;
    if (handled) event.preventDefault();
  });

  stage.addEventListener(
    "wheel",
    (event) => {
      if (!state.image) return;
      const lines = event.deltaMode === 1 ? 16 : 1;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const over =
          event.target instanceof Node && b.el.contains(event.target) && comparing() ? b : a;
        const rect = over.el.getBoundingClientRect();
        const box = geometry()[0]?.box ?? measure(stage);
        const point = {
          x: event.clientX - (rect.left + box.width / 2),
          y: event.clientY - (rect.top + box.height / 2),
        };
        viewer.zoomAt(Math.exp(-event.deltaY * lines * 0.002), point, primaryFit());
        changed();
      } else if (zoomedIn()) {
        event.preventDefault();
        viewer.pan(-event.deltaX * lines, -event.deltaY * lines);
        layout();
      }
    },
    { passive: false },
  );

  /** @type {{ x: number, y: number, ox: number, oy: number } | null} */
  let drag = null;
  stage.addEventListener("pointerdown", (event) => {
    if (!state.image || /** @type {MouseEvent} */ (event).button > 0) return;
    drag = { x: event.clientX, y: event.clientY, ox: viewer.x, oy: viewer.y };
    stage.setPointerCapture?.(/** @type {PointerEvent} */ (event).pointerId ?? 0);
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag) return;
    viewer.x = drag.ox + event.clientX - drag.x;
    viewer.y = drag.oy + event.clientY - drag.y;
    layout();
  });
  for (const type of ["pointerup", "pointercancel"])
    stage.addEventListener(type, () => (drag = null));
  stage.addEventListener("dblclick", () => (viewer.zoom === "fit" ? actual() : fitAll()));
  const win = doc.defaultView;
  if (win && "ResizeObserver" in win) new win.ResizeObserver(() => layout()).observe(stage);
  else win?.addEventListener("resize", () => layout());

  return {
    /** @param {ImagesState} next */
    render(next) {
      state = next;
      const image = next.image;
      if ((image?.path ?? null) !== path) {
        path = image?.path ?? null;
        viewer.reset(image?.orientation ?? 1);
      }
      byId("name").textContent = image?.name ?? "No image open";
      const size = image?.pixels ?? (image?.width ? image : null);
      byId("format").textContent = image
        ? [
            image.format,
            size ? `${size.width} × ${size.height}` : "",
            image.label ?? "",
            image.slice ? `slice ${image.slice.index + 1} of ${image.slice.count}` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "";
      byId("position").textContent = next.position
        ? `${next.position.index} / ${next.position.count}`
        : "";
      show(a, image);
      show(b, comparing() ? next.partner : null);
      b.el.hidden = !comparing();
      stage.classList.toggle("split", comparing());
      if (!comparing() && !image) picker.hidden = true;
      describe(image);
      offer();
      changed();
    },
    status: say,
    focus() {
      stage.focus();
    },
  };
}
