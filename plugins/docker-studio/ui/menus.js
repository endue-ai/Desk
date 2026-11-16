// The menus of rows and stacks: what can be done to the containers chosen (one or many), and to a
// Compose stack. Items that do not apply to the state are left out rather than greyed.

import { portUrl, problemOf } from "./model.js";

/**
 * @typedef {import("./studio.js").App} App
 * @typedef {import("./parse.js").Container} Container
 * @typedef {import("./overlay.js").Overlay} Overlay
 * @typedef {Parameters<Overlay["menu"]>[0]} Items
 */

/** @param {App} app @param {Container[]} rows @param {{ x: number, y: number } | HTMLElement} at */
export function containerMenu(app, rows, at) {
  const t = rows.map((c) => ({ id: c.id, name: c.name, state: c.state }));
  const one = rows.length === 1 ? rows[0] : undefined;
  const any = (/** @type {(c: Container) => boolean} */ test) => rows.some(test);
  const go = (/** @type {import("./actions.js").ContainerOp} */ op) => () =>
    void app.act.container(op, t);
  /** @type {Items} */
  const items = [];
  if (one) {
    items.push(
      { label: "Open", icon: "container", run: () => app.open({ kind: "container", id: one.id }) },
      {
        label: "Logs",
        icon: "logs",
        run: () => app.open({ kind: "container", id: one.id, tab: "logs" }),
      },
    );
    if (one.state === "running") {
      items.push({
        label: "Open a terminal",
        icon: "terminal",
        run: () => void app.act.shell(one),
      });
      items.push({
        label: "Files",
        icon: "folder",
        run: () => app.open({ kind: "container", id: one.id, tab: "files" }),
      });
      const port = one.ports[0];
      if (port)
        items.push({
          label: `Open ${portUrl(port)}`,
          icon: "external",
          run: () => void app.act.browse(portUrl(port)),
        });
    }
    if (problemOf(one))
      items.push({
        label: "Diagnose with AI",
        icon: "sparkle",
        run: () => app.ai.diagnose(one.id),
      });
    items.push("-");
  }
  if (any((c) => c.state !== "running" && c.state !== "paused"))
    items.push({ label: "Start", icon: "play", run: go("start") });
  if (any((c) => c.state === "running"))
    items.push({ label: "Stop", icon: "stop", run: go("stop") });
  items.push({ label: "Restart", icon: "restart", run: go("restart") });
  if (any((c) => c.state === "running"))
    items.push({ label: "Pause", icon: "pause", run: go("pause") });
  if (any((c) => c.state === "paused"))
    items.push({ label: "Resume", icon: "play", run: go("unpause") });
  if (any((c) => c.state === "running")) items.push({ label: "Kill", icon: "x", run: go("kill") });
  if (one) {
    items.push(
      "-",
      { label: "Copy the id", icon: "copy", run: () => void app.act.copy(one.id, "the id") },
      { label: "Copy the name", icon: "copy", run: () => void app.act.copy(one.name, "the name") },
      {
        label: "Open the image",
        icon: "image",
        run: () => app.open({ kind: "image", id: one.imageId }),
      },
    );
  }
  items.push("-", {
    label: rows.length > 1 ? `Remove ${rows.length} containers` : "Remove",
    icon: "trash",
    danger: true,
    run: go("remove"),
  });
  app.overlay.menu(items, at);
}

/**
 * @param {App} app
 * @param {{ name: string, files: string[], dir: string, containers: Container[] }} s
 * @param {{ x: number, y: number } | HTMLElement} at
 */
export function stackMenu(app, s, at) {
  const up = s.containers.some((c) => c.state === "running");
  const compose = (/** @type {Parameters<App["act"]["compose"]>[0]} */ op) => () =>
    void app.act.compose(op, s.name);
  /** @type {Items} */
  const items = [
    {
      label: "Open the stack",
      icon: "stack",
      run: () => app.open({ kind: "project", id: s.name }),
    },
    {
      label: "Logs of every service",
      icon: "logs",
      run: () => app.open({ kind: "project", id: s.name, tab: "logs" }),
    },
    "-",
    {
      label: "Up (create and start)",
      icon: "play",
      run: compose("up"),
      disabled: s.files.length === 0,
    },
    up
      ? { label: "Stop", icon: "stop", run: compose("stop") }
      : { label: "Start", icon: "play", run: compose("start") },
    { label: "Restart", icon: "restart", run: compose("restart") },
    {
      label: "Pull the images",
      icon: "download",
      run: compose("pull"),
      disabled: s.files.length === 0,
    },
  ];
  const file = s.files[0];
  if (file)
    items.push("-", {
      label: "Open the Compose file",
      icon: "file",
      run: () =>
        void app.ctx.commands
          .run("desk.files.open", { path: file })
          .catch(() => app.toast(`Could not open ${file}.`, "danger")),
    });
  items.push("-", {
    label: "Down (stop and remove)",
    icon: "trash",
    danger: true,
    run: compose("down"),
  });
  app.overlay.menu(items, at);
}

/** @param {App} app @param {import("./parse.js").Image[]} rows @param {{ x: number, y: number } | HTMLElement} at */
export function imageMenu(app, rows, at) {
  const one = rows.length === 1 ? rows[0] : undefined;
  /** @type {Items} */
  const items = [];
  if (one) {
    const ref = one.refs[0] ?? one.id;
    items.push(
      { label: "Run…", icon: "play", run: () => app.dialogs.run(ref) },
      { label: "Open", icon: "image", run: () => app.open({ kind: "image", id: one.id }) },
      {
        label: "Layers",
        icon: "layers",
        run: () => app.open({ kind: "image", id: one.id, tab: "layers" }),
      },
      "-",
    );
    if (one.refs[0])
      items.push({
        label: "Pull again",
        icon: "download",
        run: () => app.dialogs.pullRef(one.refs[0] ?? ""),
      });
    items.push(
      { label: "Tag or push…", icon: "tag", run: () => app.dialogs.tag(one) },
      {
        label: "How to make it smaller",
        icon: "sparkle",
        run: () => app.open({ kind: "image", id: one.id, tab: "layers" }),
      },
      "-",
      { label: "Copy the name", icon: "copy", run: () => void app.act.copy(ref, "the name") },
      { label: "Copy the id", icon: "copy", run: () => void app.act.copy(one.id, "the id") },
      "-",
    );
  }
  items.push({
    label: rows.length > 1 ? `Remove ${rows.length} images` : "Remove",
    icon: "trash",
    danger: true,
    run: () => void app.act.removeImages(rows),
  });
  app.overlay.menu(items, at);
}
