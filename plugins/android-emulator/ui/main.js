import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import "@endue-ai/ui";
import { installAgentTools } from "./agent.js";
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
    let sessionId = null;
    let busy = false;
    let inventory = [];
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
      procs.withoutPrompt,
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
      sessionId = next.phase === "connected" ? `${next.serial}/${crypto.randomUUID()}` : null;
      busy = false;
      el("connection").textContent = next.message;
      tools?.reset();
      display.select(next.phase === "connected" ? next : undefined);
      controls();
      if (next.phase === "connected") tools?.opened(next);
    });
    async function operate(work, expected) {
      if (expected && (session.phase !== "connected" || sessionId !== expected))
        throw new Error("That emulator session changed.");
      if (busy && expected) throw new Error("The emulator is already taking another action.");
      if (session.phase !== "connected" || busy) return;
      const selected = session;
      const operationSignal = android.bindTransport(
        AbortSignal.any([selected.signal]),
        selected.transportId,
      );
      const signal = expected ? procs.withoutPrompt(operationSignal) : operationSignal;
      busy = true;
      controls();
      report("Working…");
      try {
        if (expected) await android.verifyTransport(selected.serial, signal);
        const message = await work({ ...selected, signal });
        if (expected && session !== selected) throw new Error("That emulator session changed.");
        if (session === selected) report(message ?? "");
        return message;
      } catch (error) {
        if (session === selected) report(error.message);
        if (expected) throw error;
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
      const listed = [];
      for (const d of devices) {
        listed.push({ id: d.serial, ...d });
        const option = new Option(`${d.avd || d.serial} · ${d.avd ? d.serial : d.state}`, d.serial);
        option.disabled = d.state !== "device";
        running.append(option);
        if (!option.disabled) targets.set(d.serial, d);
      }
      const installed = document.createElement("optgroup");
      installed.label = "Available virtual devices";
      for (const avd of avds.filter((a) => !devices.some((d) => d.avd === a))) {
        const id = `avd:${avd}`;
        listed.push({ id, avd });
        installed.append(new Option(avd, id));
        targets.set(id, { avd });
      }
      picker.replaceChildren();
      inventory = listed;
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
    installAgentTools(ctx.commands, {
      state: () => ({
        phase: session.phase,
        discovering: Boolean(discovery),
        devices: inventory,
        picked: picker.value || null,
        session: sessionId ? { id: sessionId, serial: session.serial, label: session.label } : null,
        preview: display.state(),
        ...tools.state(),
      }),
      operate,
      android,
      display,
      tools,
      disconnect: connection.disconnect,
    });
    picker.addEventListener("change", controls);
    connect.addEventListener("click", () => {
      if (session.phase !== "idle") {
        connection.disconnect();
        controls();
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
    controls();
  },
});
