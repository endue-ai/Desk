// Write a Dockerfile: pick the platform and answer a few questions (port, what starts, a user that
// is not root, a health check, a compose.yaml with a database or a cache); the files show as they
// are made; save them into a folder (asked before replacing a file there) and build it from there,
// or have AI tailor them to what the project says it is.

import { button, h, icon } from "./dom.js";
import { check, field, input, select } from "./form.js";
import { filesFor, PLATFORMS, scaffoldFor } from "./templates.js";

/** @typedef {import("./studio.js").App} App @typedef {import("./templates.js").Platform} Platform */

/** Write files into a folder through the desk's fs grant for that folder alone; asks before replacing. */
export async function saveFiles(
  /** @type {App} */ app,
  /** @type {string} */ folder,
  /** @type {Array<[string, string]>} */ files,
) {
  if (!folder.startsWith("/") || folder.includes("\0"))
    throw new Error("Write the folder's whole path, starting with /.");
  const dir = folder.replace(/\/+$/, "");
  const read = { permission: "fs:read", paths: [`${dir}/**`] };
  const write = { permission: "fs:write", paths: [`${dir}/**`] };
  const call = async (
    /** @type {string} */ method,
    /** @type {any} */ params,
    /** @type {any} */ scope,
  ) => {
    try {
      return await app.ctx.bridge.call(method, { ...params, scope });
    } catch (error) {
      if (/** @type {any} */ (error)?.code !== "permission_denied") throw error;
      const answer = await app.ctx.bridge.call("perm.request", {
        permission: scope,
        reason: `To write the Docker files into ${dir}`,
      });
      if (!answer?.granted) throw new Error(`Not allowed to write into ${dir}.`);
      return app.ctx.bridge.call(method, { ...params, scope });
    }
  };
  const there = [];
  for (const [name] of files) {
    const found = await call("fs.stat", { path: `${dir}/${name}` }, read).catch(() => null);
    if (found) there.push(name);
  }
  if (there.length) {
    const yes = await app.overlay.confirm({
      title: `Replace ${there.join(", ")}?`,
      text: `${dir} already has ${there.length === 1 ? "it" : "them"}. The desk keeps the old versions in the file's history.`,
      ok: "Replace",
      danger: true,
    });
    if (!yes) return false;
  }
  for (const [name, content] of files)
    await call(
      "fs.write",
      { path: `${dir}/${name}`, content, encoding: "utf8", createDirs: true },
      write,
    );
  return true;
}

/** @param {App} app */
export function openScaffoldDialog(app) {
  const o = scaffoldFor("node");
  let folder = "";
  let tab = "Dockerfile";
  /** Files AI tailored, shown until an option changes. @type {Array<[string, string]> | null} */
  let custom = null;
  const current = () => custom ?? filesFor(o);
  const tabs = h("nav.desk-tabs.file-tabs", { role: "tablist" });
  const code = h("pre.code.scaffold-code");
  const entry = input({
    value: o.entry,
    mono: true,
    label: "Starts",
    onInput: (v) => {
      o.entry = v;
      changed();
    },
  });
  const entryHint = h("small.field-hint", null, PLATFORMS[o.platform].hint);
  const port = input({
    value: String(o.port),
    mono: true,
    label: "Port",
    onInput: (v) => {
      o.port = Number(v) || 0;
      changed();
    },
  });
  const version = input({
    value: o.version,
    mono: true,
    label: "Version",
    onInput: (v) => {
      o.version = v;
      changed();
    },
  });

  const draw = () => {
    const files = current();
    if (!files.some(([n]) => n === tab)) tab = "Dockerfile";
    tabs.replaceChildren(
      ...files.map(([name]) =>
        h(
          "button.desk-tab",
          {
            type: "button",
            role: "tab",
            "aria-selected": name === tab ? "true" : "false",
            onClick: () => {
              tab = name;
              draw();
            },
          },
          icon("file", 13),
          name,
        ),
      ),
    );
    const text = files.find(([n]) => n === tab)?.[1] ?? "";
    code.replaceChildren(
      ...text
        .trimEnd()
        .split("\n")
        .map((l, i) =>
          h("div.code-line", null, h("span.ln", null, String(i + 1)), h("span", null, l)),
        ),
    );
  };

  const changed = () => {
    custom = null;
    draw();
  };

  const platform = (/** @type {Platform} */ id) => {
    Object.assign(o, scaffoldFor(id, o.name), { compose: o.compose, db: o.db, cache: o.cache });
    entry.value = o.entry;
    port.value = String(o.port);
    version.value = o.version;
    entryHint.textContent = PLATFORMS[id].hint;
    for (const b of choices.querySelectorAll("button"))
      b.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (b).dataset.id === id));
    changed();
  };
  const choices = h(
    "div.platforms",
    null,
    Object.entries(PLATFORMS).map(([id, p]) =>
      h(
        "button.desk-btn.desk-btn-quiet.platform",
        {
          type: "button",
          dataset: { id },
          "aria-pressed": String(id === o.platform),
          onClick: () => platform(/** @type {Platform} */ (id)),
        },
        p.label,
      ),
    ),
  );

  const save = button({
    label: "Save into the folder",
    icon: "download",
    kind: "desk-btn-primary",
    onClick: async () => {
      try {
        if (!(await saveFiles(app, folder.trim(), current()))) return;
        app.toast(
          `Wrote ${current()
            .map(([n]) => n)
            .join(", ")} into ${folder}.`,
          "success",
        );
        save.replaceWith(
          button({
            label: "Build it",
            icon: "build",
            kind: "desk-btn-primary",
            onClick: () => {
              dialog.close();
              app.dialogs.build({
                context: folder.trim().replace(/\/+$/, ""),
                tag: `${o.name}:dev`,
              });
            },
          }),
        );
      } catch (error) {
        app.toast(String(/** @type {any} */ (error)?.message ?? error), "danger");
      }
    },
  });

  const body = h(
    "div.scaffold",
    null,
    h(
      "div.scaffold-form",
      null,
      h("span.field-label", null, "Platform"),
      choices,
      h(
        "div.form-grid",
        null,
        field(
          "Service name",
          input({
            value: o.name,
            label: "Service name",
            onInput: (v) => {
              o.name = v.trim() || "app";
              changed();
            },
          }),
        ),
        field("Version", version),
        h("label.field", null, h("span.field-label", null, "Starts"), entry, entryHint),
        field("Port", port),
      ),
      h(
        "div.checks.column",
        null,
        check("Run as a user that is not root", o.nonRoot, (on) => {
          o.nonRoot = on;
          changed();
        }),
        check("Check its health", o.health, (on) => {
          o.health = on;
          changed();
        }),
        check("A compose.yaml too", o.compose, (on) => {
          o.compose = on;
          changed();
        }),
        check("With a Redis cache", o.cache, (on) => {
          o.cache = on;
          changed();
        }),
      ),
      field(
        "Database",
        select(
          [
            ["", "None"],
            ["postgres", "PostgreSQL"],
            ["mysql", "MySQL"],
          ],
          o.db,
          (v) => {
            o.db = /** @type {any} */ (v);
            changed();
          },
          "Database",
        ),
      ),
      field(
        "Save into",
        input({
          placeholder: "/Users/you/code/app",
          mono: true,
          label: "Folder",
          onInput: (v) => {
            folder = v;
          },
        }),
        "The project's folder; asked before a file there is replaced",
      ),
    ),
    h("div.scaffold-preview", null, tabs, code),
  );
  const dialog = app.overlay.dialog({
    title: "Write a Dockerfile",
    subtitle: "Starting files for a project, ready to build",
    icon: "wand",
    wide: true,
    body,
    actions: [
      button({
        label: "Tailor with AI",
        icon: "sparkle",
        kind: "desk-btn-quiet ai lead",
        onClick: () =>
          app.ai.tailorScaffold(o, current(), (/** @type {Array<[string, string]>} */ files) => {
            custom = files;
            draw();
          }),
      }),
      button({
        label: "Copy",
        icon: "copy",
        kind: "desk-btn-quiet",
        onClick: () => void app.act.copy(current().find(([n]) => n === tab)?.[1] ?? "", tab),
      }),
      save,
    ],
  });
  changed();
}
