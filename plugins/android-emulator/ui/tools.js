import { builtins, environmentSteps, savedPresets } from "./environment.js";

const png = [{ name: "PNG image", extensions: ["png"] }];
const apk = [{ name: "Android application", extensions: ["apk"] }];

function asBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function wireTools(doc, bridge, android, { operate, report, disconnect }) {
  const el = (id) => doc.getElementById(id);
  const click = (id, work) => el(id).addEventListener("click", () => void operate(work));
  const dialog = el("confirm");
  el("confirm-cancel").addEventListener("click", () => dialog.close("cancel"));
  el("confirm-action").addEventListener("click", () => dialog.close("accept"));
  async function confirm(title, message, action) {
    el("confirm-title").textContent = title;
    el("confirm-message").textContent = message;
    el("confirm-action").textContent = action;
    dialog.returnValue = "cancel";
    const closed = new Promise((resolve) =>
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "accept"), {
        once: true,
      }),
    );
    dialog.showModal();
    el("confirm-cancel").focus();
    return closed;
  }

  let log = "";
  const filterLogs = () => {
    const query = el("log-filter").value.toLowerCase();
    const lines = log
      .split(/\r?\n/)
      .filter((line) => line.length > 0 && line.toLowerCase().includes(query));
    el("log-output").textContent = lines.join("\n") || (log ? "No matching lines." : "");
  };
  el("log-filter").addEventListener("input", filterLogs);

  const snapshotList = (names) => {
    const select = el("snapshots");
    const selected = select.value;
    select.replaceChildren(
      ...(names.length
        ? names.map((n) => new Option(n, n))
        : [new Option("No snapshots listed", "")]),
    );
    if (names.includes(selected)) select.value = selected;
  };
  async function loadSnapshots({ serial, signal }) {
    const names = await android.snapshots(serial, signal);
    if (!signal.aborted) snapshotList(names);
    return names;
  }
  async function loadApps({ serial, signal }) {
    const packages = await android.packages(serial, signal);
    if (signal.aborted) return;
    const select = el("packages");
    const previous = select.value;
    select.replaceChildren(...packages.map((id) => new Option(id, id)));
    if (!packages.length) select.add(new Option("No user apps installed", ""));
    if (packages.includes(previous)) select.value = previous;
    if (select.value !== previous) el("app-output").textContent = "";
  }
  for (const button of doc.querySelectorAll("[data-inspect]")) {
    button.addEventListener(
      "click",
      () =>
        void operate(async ({ serial, signal }) => {
          const text = await android.inspectApp(
            serial,
            el("packages").value,
            button.dataset.inspect,
            signal,
          );
          if (!signal.aborted) el("app-output").textContent = text;
        }),
    );
  }
  el("packages").addEventListener("change", () => {
    el("app-output").textContent = "";
  });
  click("list-apps", loadApps);
  for (const button of doc.querySelectorAll("[data-panel]")) {
    button.addEventListener("click", () => {
      for (const tab of doc.querySelectorAll("[data-panel]")) {
        const selected = tab === button;
        tab.setAttribute("aria-pressed", String(selected));
        el(tab.dataset.panel).hidden = !selected;
      }
      if (button.dataset.panel === "apps") void operate(loadApps);
      if (button.dataset.panel === "tools")
        void operate(async (session) => {
          await loadSnapshots(session);
        });
    });
  }
  click("list-snapshots", async (session) => {
    await loadSnapshots(session);
  });
  click("restore", async ({ serial, signal }) => {
    const tag = el("snapshots").value;
    if (!tag) throw new Error("Choose a saved snapshot first.");
    if (
      !(await confirm(
        `Restore ${tag}?`,
        "The device will return to the apps, files and settings in this snapshot.",
        "Restore snapshot",
      )) ||
      signal.aborted
    )
      return;
    await android.snapshot(serial, "load", tag, signal);
    return `Restored ${tag}.`;
  });
  el("save-snapshot").addEventListener("submit", (event) => {
    event.preventDefault();
    const tag = el("save-snapshot").elements.name.value.trim();
    void operate(async (session) => {
      const names = await loadSnapshots(session);
      if (session.signal.aborted) return;
      if (
        names.includes(tag) &&
        !(await confirm(
          `Replace ${tag}?`,
          "Saving here replaces the previous device state in this snapshot.",
          "Replace snapshot",
        ))
      )
        return;
      await android.snapshot(session.serial, "save", tag, session.signal);
      await loadSnapshots(session);
      if (!session.signal.aborted) el("snapshots").value = tag;
      return `Saved ${tag}.`;
    });
  });
  click("install", async ({ serial, signal }) => {
    const file = await bridge.call("dialog.open", {
      kind: "files",
      title: "Install an APK",
      filters: apk,
    });
    if (file.cancelled || signal.aborted) return;
    await android.install(serial, file.paths[0], signal);
    await loadApps({ serial, signal });
    return "Android installed the APK.";
  });
  click("screenshot", async ({ serial, signal }) => {
    const blob = await android.capture(serial, signal);
    if (signal.aborted) return;
    const file = await bridge.call("dialog.save", {
      title: "Save device screenshot",
      suggestedName: `${serial}.png`,
      filters: png,
    });
    if (file.cancelled || signal.aborted) return;
    const content = await asBase64(blob);
    if (signal.aborted) return;
    await bridge.call("fs.write", {
      path: file.path,
      encoding: "base64",
      content,
      scope: { permission: "fs:write", paths: [file.path] },
    });
    return `Saved the screenshot to ${file.path}.`;
  });
  click("read-logs", async ({ serial, signal }) => {
    const text = await android.logs(serial, el("priority").value, signal);
    if (!signal.aborted) {
      log = text;
      filterLogs();
    }
    return "Logcat refreshed.";
  });
  click("power", async ({ serial, label, signal }) => {
    if (
      !(await confirm(
        `Shut down ${label}?`,
        "Android and its running apps will stop.",
        "Shut down",
      )) ||
      signal.aborted
    )
      return;
    await android.powerOff(serial, signal);
    if (!signal.aborted) disconnect(`Shut down ${label}. Refresh the devices to start it again.`);
  });

  const form = el("environment");
  const presets = el("preset");
  let saved = savedPresets(
    (await bridge.call("store.get", { key: "presets" }).catch(() => ({}))).value,
  );
  const all = () => [...builtins, ...saved];
  function drawPresets(selected = "") {
    presets.replaceChildren(
      new Option("Custom conditions", ""),
      ...all().map((p) => new Option(p.name, p.name)),
    );
    presets.value = selected;
  }
  drawPresets();
  presets.addEventListener("change", () => {
    const p = all().find((p) => p.name === presets.value);
    for (const field of form.querySelectorAll("[name]")) field.value = p?.values[field.name] ?? "";
    el("save-preset").elements.name.value = saved.includes(p) ? p.name : "";
  });
  form.addEventListener("input", (event) => {
    if (event.target !== presets) presets.value = "";
  });
  const values = () => Object.fromEntries(new FormData(form));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void operate(async ({ serial, signal }) => {
      const count = await android.apply(serial, values(), signal);
      return `Applied ${count} device changes.`;
    });
  });
  el("save-preset").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const name = form.elements.name.value.trim();
      const v = values();
      environmentSteps(v);
      if (!name || builtins.some((p) => p.name === name))
        throw new Error("Choose a name for your own preset.");
      const next = [...saved.filter((p) => p.name !== name), { name, values: v }];
      if (next.length > 24)
        throw new Error("Choose an existing preset name to replace one of your 24 presets.");
      await bridge.call("store.set", { key: "presets", value: next });
      saved = next;
      drawPresets(name);
      report(`Saved preset ${name}.`);
    } catch (error) {
      report(error.message);
    } finally {
      button.disabled = false;
    }
  });
  return {
    reset() {
      if (dialog.open) dialog.close("cancel");
      snapshotList([]);
      el("packages").replaceChildren();
      el("app-output").textContent = "";
      log = "";
      el("log-output").textContent = "";
      report("");
    },
    opened(session) {
      if (!el("apps").hidden) void operate(loadApps);
      if (!el("tools").hidden)
        void operate(async () => {
          await loadSnapshots(session);
        });
    },
  };
}
