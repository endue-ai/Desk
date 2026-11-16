// Run a container: the image (a local one, or any reference, pulled on the way), a name, ports,
// volumes, variables, restart policy, network and command, with the image's own exposed ports and
// variables offered, and the docker run line it makes shown as it is typed, to copy.

import { button, h, icon } from "./dom.js";
import { check, field, input, rows, select } from "./form.js";
import { formFor, runArgs, shellLine } from "./images.js";
import { imageName } from "./model.js";

/** @typedef {import("./studio.js").App} App */

/** @param {App} app @param {string} [ref] */
export function openRunDialog(app, ref = "") {
  const images = app.store.state.images.filter((i) => !i.dangling);
  const find = (/** @type {string} */ r) =>
    app.store.state.images.find(
      (i) => i.refs.includes(r) || i.refs.includes(`${r}:latest`) || i.id === r,
    );
  const first = find(ref);
  const form = formFor(first?.refs[0] ?? ref, first?.exposed ?? []);
  const line = h("code.cmd-line");
  const problem = h("p.form-error", { role: "alert" });
  const runBtn = button({
    label: "Run",
    icon: "play",
    kind: "desk-btn-primary",
    onClick: () => void go(),
  });

  const changed = () => {
    try {
      const args = runArgs(form);
      line.textContent = shellLine(args);
      problem.textContent = "";
      runBtn.disabled = !form.image.trim();
    } catch (error) {
      problem.textContent = String(/** @type {any} */ (error)?.message ?? error);
      runBtn.disabled = true;
    }
  };

  const listId = "ds-image-list";
  const imageField = input({
    value: form.image,
    placeholder: "nginx:latest, or one of yours",
    mono: true,
    list: listId,
    label: "Image",
    onInput: (v) => {
      form.image = v;
      const known = find(v);
      hint.textContent = known
        ? `${imageName(known)} is here: it runs at once.`
        : v.trim()
          ? "Not on this engine: docker pulls it first."
          : "";
      changed();
    },
  });
  const hint = h(
    "small.field-hint",
    null,
    first ? `${imageName(first)} is here: it runs at once.` : "",
  );
  const datalist = h(
    "datalist",
    { id: listId },
    images.flatMap((i) => i.refs.map((r) => h("option", { value: r }))),
  );

  const portRows = rows({
    title: "Ports",
    items: form.ports,
    make: () => ({ host: "", container: "", proto: "tcp" }),
    add: "Publish a port",
    empty: "No port published: reach it from other containers only.",
    changed,
    row: (p, ch) => [
      input({
        value: p.host,
        placeholder: "Host (any)",
        mono: true,
        label: "Port on this computer",
        onInput: (v) => {
          p.host = v;
          ch();
        },
      }),
      h("span.rows-arrow", null, icon("chevronRight", 14)),
      input({
        value: p.container,
        placeholder: "Container",
        mono: true,
        label: "Port in the container",
        onInput: (v) => {
          p.container = v;
          ch();
        },
      }),
      select(
        [
          ["tcp", "TCP"],
          ["udp", "UDP"],
        ],
        p.proto,
        (v) => {
          p.proto = v;
          ch();
        },
        "Protocol",
      ),
    ],
  });
  const volumeRows = rows({
    title: "Volumes",
    items: form.volumes,
    make: () => ({ source: "", target: "", readOnly: false }),
    add: "Mount a volume or folder",
    empty: "Nothing mounted: what it writes goes with it.",
    changed,
    row: (v, ch) => [
      input({
        value: v.source,
        placeholder: "Volume name or /host/folder",
        mono: true,
        label: "Source",
        list: "ds-volume-list",
        onInput: (x) => {
          v.source = x;
          ch();
        },
      }),
      h("span.rows-arrow", null, icon("chevronRight", 14)),
      input({
        value: v.target,
        placeholder: "/path/in/container",
        mono: true,
        label: "Target",
        onInput: (x) => {
          v.target = x;
          ch();
        },
      }),
      check("Read-only", v.readOnly, (on) => {
        v.readOnly = on;
        ch();
      }),
    ],
  });
  const volumes = h(
    "datalist",
    { id: "ds-volume-list" },
    app.store.state.volumes.map((v) => h("option", { value: v.name })),
  );
  const envRows = rows({
    title: "Environment variables",
    items: form.env,
    make: () => ({ key: "", value: "" }),
    add: "Add a variable",
    changed,
    row: (e, ch) => [
      input({
        value: e.key,
        placeholder: "NAME",
        mono: true,
        label: "Name",
        onInput: (v) => {
          e.key = v;
          ch();
        },
      }),
      h("span.rows-arrow", null, "="),
      input({
        value: e.value,
        placeholder: "value",
        mono: true,
        label: "Value",
        onInput: (v) => {
          e.value = v;
          ch();
        },
      }),
    ],
  });
  const networks = app.store.state.networks.filter((n) => n.name !== "none");
  const body = h(
    "div.run-form",
    null,
    h(
      "div.form-grid",
      null,
      h(
        "label.field.span2",
        null,
        h("span.field-label", null, "Image"),
        imageField,
        hint,
        datalist,
      ),
      field(
        "Name",
        input({
          placeholder: "A name, or docker picks one",
          label: "Name",
          onInput: (v) => {
            form.name = v;
            changed();
          },
        }),
      ),
      field(
        "Restart",
        select(
          [
            ["no", "Never"],
            ["unless-stopped", "Unless stopped"],
            ["always", "Always"],
            ["on-failure", "On failure"],
          ],
          form.restart,
          (v) => {
            form.restart = v;
            changed();
          },
          "Restart policy",
        ),
      ),
      field(
        "Network",
        select(
          [
            ["", "Default (bridge)"],
            ...networks.map((n) => /** @type {[string, string]} */ ([n.name, n.name])),
          ],
          "",
          (v) => {
            form.network = v;
            changed();
          },
          "Network",
        ),
      ),
      field(
        "Command",
        input({
          placeholder: "The image's own when empty",
          mono: true,
          label: "Command",
          onInput: (v) => {
            form.command = v;
            changed();
          },
        }),
      ),
    ),
    portRows,
    volumeRows,
    volumes,
    envRows,
    h(
      "div.checks",
      null,
      check("Remove it when it stops", false, (on) => {
        form.remove = on;
        changed();
      }),
      check("Keep stdin open with a terminal (-it)", false, (on) => {
        form.interactive = on;
        changed();
      }),
    ),
    h(
      "div.cmd-preview",
      null,
      h("span.field-label", null, "Command line"),
      h(
        "div.cmd-box",
        null,
        line,
        button({
          label: "Copy the command",
          icon: "copy",
          hideLabel: true,
          onClick: () => void app.act.copy(line.textContent ?? "", "the command"),
        }),
      ),
    ),
    problem,
  );
  const dialog = app.overlay.dialog({
    title: "Run a container",
    subtitle: "Start a new container from an image",
    icon: "play",
    wide: true,
    body,
    actions: [
      button({ label: "Cancel", kind: "desk-btn-quiet", onClick: () => dialog.close() }),
      runBtn,
    ],
  });
  const go = async () => {
    runBtn.disabled = true;
    runBtn.replaceChildren(h("span.spinner"), " Starting…");
    const ok = await app.images.run(runArgs(form), form.name || form.image);
    if (ok) dialog.close();
    else {
      runBtn.disabled = false;
      runBtn.replaceChildren(icon("play"), h("span.label", null, "Run"));
    }
  };
  changed();
  if (!first) imageField.focus();
}
