// Clean up: what can go and how much each gives back (stopped containers, dangling and unused
// images, the build cache, unused networks, and unused volumes, which hold data and stay unticked),
// then one prune after another with each one's result.

import { runPrune } from "./cleanup.js";
import { button, h, icon } from "./dom.js";
import { check } from "./form.js";
import { bytes } from "./format.js";
import { imageUse, volumeUse } from "./model.js";

/** @typedef {import("./studio.js").App} App */

/** @param {App} app */
export function openCleanupDialog(app) {
  const s = app.store.state;
  const use = imageUse(s.containers);
  const mounted = volumeUse(s.containers);
  const disk = (/** @type {string} */ kind) => s.disk.find((d) => d.kind === kind);
  const stopped = s.containers.filter(
    (c) => c.state === "exited" || c.state === "created" || c.state === "dead",
  );
  const dangling = s.images.filter((i) => i.dangling && !use.get(i.id));
  const unused = s.images.filter((i) => !use.get(i.id));
  const volumes = s.volumes.filter((v) => !mounted.has(v.name));
  const networks = s.networks.filter((n) => !n.builtin && n.members.length === 0);
  const sum = (/** @type {number[]} */ list) => list.reduce((a, b) => a + b, 0);

  const items = /** @type {const} */ ([
    {
      id: "containers",
      label: "Stopped containers",
      note: `${stopped.length}: ${stopped
        .slice(0, 4)
        .map((c) => c.name)
        .join(", ")}${stopped.length > 4 ? "…" : ""}`,
      size: disk("containers")?.reclaimable ?? 0,
      on: stopped.length > 0,
      n: stopped.length,
    },
    {
      id: "dangling",
      label: "Dangling images",
      note: `${dangling.length} without a name, left by builds`,
      size: sum(dangling.map((i) => i.size)),
      on: dangling.length > 0,
      n: dangling.length,
    },
    {
      id: "images",
      label: "Every unused image",
      note: `${unused.length} no container uses; pulled or built again when needed`,
      size: sum(unused.map((i) => i.size)),
      on: false,
      n: unused.length,
    },
    {
      id: "cache",
      label: "Build cache",
      note: "Builds run every step again once",
      size: disk("cache")?.reclaimable ?? 0,
      on: (disk("cache")?.reclaimable ?? 0) > 0,
      n: 1,
    },
    {
      id: "networks",
      label: "Unused networks",
      note: networks.map((n) => n.name).join(", ") || "none",
      size: 0,
      on: networks.length > 0,
      n: networks.length,
    },
    {
      id: "volumes",
      label: "Unused volumes",
      note: `${volumes.length} no container mounts — their data is deleted for good`,
      size: sum(volumes.map((v) => s.volumeSizes.get(v.name) ?? 0)),
      on: false,
      n: volumes.length,
      danger: true,
    },
  ])
    .map((i) => ({ ...i }))
    .filter((i) => i.n > 0);

  const total = h("b.cleanup-total");
  const sync = () => {
    const chosen = items.filter((i) => i.on);
    const free = sum(
      chosen.map((i) =>
        i.id === "dangling" && items.find((x) => x.id === "images")?.on ? 0 : i.size,
      ),
    );
    total.textContent = bytes(free);
    go.disabled = chosen.length === 0;
    go.querySelector(".label")?.replaceChildren(document.createTextNode(`Clean up ${bytes(free)}`));
  };
  const rows = items.map((i) => {
    const result = h("span.cleanup-result");
    const row = h(
      `div.cleanup-row${i.danger ? ".danger" : ""}`,
      null,
      check(i.label, i.on, (on) => {
        i.on = on;
        sync();
      }),
      h("small.muted", null, i.note),
      h("span.num", null, i.size ? bytes(i.size) : ""),
      result,
    );
    return { i, row, result };
  });
  const go = button({
    label: "Clean up",
    icon: "broom",
    kind: "desk-btn-primary",
    onClick: async () => {
      go.disabled = true;
      const chosen = new Map(rows.filter(({ i }) => i.on).map(({ i, result }) => [i.id, result]));
      await runPrune(
        app,
        [...chosen.keys()],
        (kind) => chosen.get(kind)?.replaceChildren(h("span.spinner")),
        ({ kind, done, freed }) =>
          chosen
            .get(kind)
            ?.replaceChildren(
              done ? icon("check", 14) : icon("alert", 14),
              freed ? ` ${freed}` : "",
            ),
      );
      app.toast("Cleaned up.", "success");
      go.replaceWith(
        button({ label: "Done", kind: "desk-btn-primary", onClick: () => dialog.close() }),
      );
    },
  });
  const dialog = app.overlay.dialog({
    title: "Clean up",
    subtitle: "Give disk space back to this computer",
    icon: "broom",
    body: items.length
      ? [
          h(
            "div.cleanup-rows",
            null,
            rows.map((r) => r.row),
          ),
          h("p.cleanup-sum", null, "Comes back: ", total),
        ]
      : [h("p.card-empty", null, icon("check"), "Nothing to clean up: everything is in use.")],
    actions: [
      button({ label: "Cancel", kind: "desk-btn-quiet", onClick: () => dialog.close() }),
      go,
    ],
  });
  sync();
}
