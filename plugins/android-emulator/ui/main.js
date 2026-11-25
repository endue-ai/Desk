import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import "@endue-ai/ui";
import { createAndroid } from "./android.js";
import { createConnection } from "./connection.js";
import { createDisplay } from "./display.js";
import { createProcesses } from "./process.js";
import { wireTools } from "./tools.js";

defineUiPlugin({
  async mount(ctx) {
    const el = (id) => document.getElementById(id);
    const picker = el("device");
    const connect = el("connect");
    const sdkKey = "endue.android-emulator.sdk";
    let root = (await ctx.settings.get(sdkKey)) || "";
    const procs = createProcesses(ctx.bridge, () => root);
    const android = createAndroid(procs);
    let session = { phase: "idle" };
    let busy = false;
    let tools, discovery;
    const targets = new Map();
    const report = (text) => {
      el("feedback").textContent = text;
    };
    const display = createDisplay(
      el("display"),
      android,
      report,
      ({ drawn, paused }) => {
        el("display-message").hidden = drawn;
        el("display-message").textContent =
          session.phase === "connected"
            ? paused
              ? "Preview is paused."
              : "Waiting for the first frame…"
            : "The device screen appears here when connected.";
        el("pause").textContent = paused ? "Resume preview" : "Pause preview";
      },
      (message) => connection.disconnect(message),
    );
    function controls() {
      const idle = session.phase === "idle";
      const online = session.phase === "connected";
      const target = targets.get(picker.value);
      picker.disabled = !idle || !targets.size;
      connect.disabled = idle && !target;
      connect.textContent = online
        ? "Disconnect"
        : !idle
          ? "Cancel"
          : target && !target.serial
            ? "Start device"
            : "Connect";
      el("refresh").disabled = !idle || Boolean(discovery);
      el("sdk").elements.root.disabled = !idle;
      el("sdk").querySelector("button").disabled = !idle;
      el("navigation").disabled = !online || busy;
      for (const b of document.querySelectorAll("[data-online]")) b.disabled = !online || busy;
    }
    const connection = createConnection(android, (next) => {
      session = next;
      busy = false;
      el("connection").textContent = next.message;
      tools?.reset();
      display.select(next.phase === "connected" ? next : undefined);
      controls();
      if (next.phase === "connected") tools?.opened(next);
    });
    async function operate(work) {
      if (session.phase !== "connected" || busy) return;
      const selected = session;
      busy = true;
      controls();
      report("Working…");
      try {
        const message = await work(selected);
        if (session === selected) report(message ?? "");
      } catch (error) {
        if (session === selected) report(error.message);
      } finally {
        if (session === selected) {
          busy = false;
          controls();
        }
      }
    }
    async function refresh() {
      discovery?.abort();
      const controller = new AbortController();
      discovery = controller;
      const previous = picker.value;
      targets.clear();
      controls();
      el("connection").textContent = "Looking for local devices…";
      const { devices, avds, warnings } = await android.inventory(controller.signal);
      if (controller.signal.aborted) return;
      const running = document.createElement("optgroup");
      running.label = "Running emulators";
      for (const d of devices) {
        const option = new Option(`${d.avd || d.serial} · ${d.avd ? d.serial : d.state}`, d.serial);
        option.disabled = d.state !== "device";
        running.append(option);
        if (!option.disabled) targets.set(d.serial, d);
      }
      const installed = document.createElement("optgroup");
      installed.label = "Available virtual devices";
      for (const avd of avds.filter((a) => !devices.some((d) => d.avd === a))) {
        const id = `avd:${avd}`;
        installed.append(new Option(avd, id));
        targets.set(id, { avd });
      }
      picker.replaceChildren();
      if (running.children.length) picker.append(running);
      if (installed.children.length) picker.append(installed);
      if (targets.size)
        picker.value = targets.has(previous) ? previous : targets.keys().next().value;
      else if (!running.children.length) picker.add(new Option("No local devices", ""));
      el("discovery-error").textContent = warnings.join(" ");
      el("discovery-error").hidden = !warnings.length;
      el("connection").textContent = targets.size
        ? "Choose a running emulator or start a virtual device."
        : "Create an Android virtual device in Device Manager, then refresh.";
      discovery = undefined;
      controls();
    }
    tools = await wireTools(document, ctx.bridge, android, {
      operate,
      report,
      disconnect: connection.disconnect,
    });
    picker.addEventListener("change", controls);
    connect.addEventListener("click", () => {
      if (session.phase !== "idle") {
        connection.disconnect();
        void refresh();
      } else {
        const target = targets.get(picker.value);
        if (target) void connection.open(target);
      }
    });
    el("refresh").addEventListener("click", () => void refresh());
    for (const b of document.querySelectorAll("[data-key]"))
      b.addEventListener(
        "click",
        () =>
          void operate(({ serial, signal }) =>
            android.key(serial, b.dataset.key, signal).then(() => ""),
          ),
      );
    el("rotate").addEventListener(
      "click",
      () => void operate(({ serial, signal }) => android.rotate(serial, signal)),
    );
    el("pause").addEventListener("click", display.toggle);
    const settings = el("sdk");
    settings.elements.root.value = root;
    settings.addEventListener("submit", async (event) => {
      event.preventDefault();
      const next = settings.elements.root.value.trim();
      if (next && !/^(?:\/|[A-Za-z]:[\\/])/.test(next))
        return report("Enter an absolute Android SDK directory.");
      try {
        await ctx.settings.set(sdkKey, next);
        root = next;
        await refresh();
      } catch (error) {
        report(error.message);
      }
    });
    window.addEventListener(
      "pagehide",
      () => {
        discovery?.abort();
        connection.disconnect();
        display.dispose();
        procs.dispose();
      },
      { once: true },
    );
    await refresh();
  },
});
