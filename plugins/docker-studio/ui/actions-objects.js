// What changes volumes and networks: create, remove (asked first, the containers that use one
// named), remove every unused one, and connect or disconnect a container.

import { h } from "./dom.js";
import { bytes } from "./format.js";
import { volumeUse } from "./model.js";
import { objectRef } from "./refs.js";

/** @typedef {import("./studio.js").App} App @typedef {import("./parse.js").Volume} Volume @typedef {import("./parse.js").Network} Network */

/** @param {App} app */
export function createObjectActions(app) {
  const say = (/** @type {unknown} */ error) =>
    app.toast(String(/** @type {any} */ (error)?.message ?? error), "danger");
  const reload = (/** @type {...string} */ ...names) => {
    for (const name of names) void app.engine.load(/** @type {any} */ (name));
  };

  const removeVolumes = async (/** @type {Volume[]} */ list) => {
    if (!list.length) return false;
    const use = volumeUse(app.store.state.containers);
    const used = list.filter((v) => use.has(v.name));
    const size = list.reduce((s, v) => s + (app.store.state.volumeSizes.get(v.name) ?? 0), 0);
    const yes = await app.overlay.confirm({
      title:
        list.length === 1
          ? `Remove the volume ${list[0]?.name}?`
          : `Remove ${list.length} volumes?`,
      text: `What they hold is deleted for good${size ? ` (${bytes(size)})` : ""}.${used.length ? ` Containers mount ${used.length === 1 ? "one of them" : `${used.length} of them`}: remove those containers first.` : ""}`,
      ok: "Delete for good",
      danger: true,
    });
    if (!yes) return false;
    try {
      await app.docker(["volume", "rm", "--", ...list.map((v) => objectRef(v.name, "The volume"))]);
      app.toast(
        list.length === 1 ? `Removed ${list[0]?.name}.` : `Removed ${list.length} volumes.`,
        "success",
      );
      return true;
    } catch (error) {
      say(error);
      return false;
    } finally {
      reload("volumes", "disk");
    }
  };

  const pruneVolumes = async () => {
    const use = volumeUse(app.store.state.containers);
    const unused = app.store.state.volumes.filter((v) => !use.has(v.name));
    if (!unused.length) return app.toast("Every volume is in use.", "info");
    const yes = await app.overlay.confirm({
      title: `Delete ${unused.length} unused volumes?`,
      text: "No container mounts them. What they hold is deleted for good: databases, uploads, caches.",
      ok: "Delete for good",
      danger: true,
      detail: h(
        "ul.confirm-list",
        null,
        unused
          .slice(0, 12)
          .map((v) =>
            h(
              "li",
              null,
              h("span", null, v.anonymous ? `${v.name.slice(0, 12)}… (anonymous)` : v.name),
              h("small", null, bytes(app.store.state.volumeSizes.get(v.name) ?? 0)),
            ),
          ),
      ),
    });
    if (!yes) return;
    try {
      await app.docker(["volume", "prune", "--all", "--force"], { timeoutMs: 0 });
      app.toast("Deleted the unused volumes.", "success");
    } catch (error) {
      say(error);
    } finally {
      reload("volumes", "disk");
    }
  };

  const createVolume = async (
    /** @type {string} */ name,
    /** @type {string} */ driver = "local",
  ) => {
    try {
      await app.docker([
        "volume",
        "create",
        "--driver",
        objectRef(driver, "The driver"),
        "--",
        objectRef(name, "The volume"),
      ]);
      app.toast(`Created the volume ${name}.`, "success");
      reload("volumes");
      return true;
    } catch (error) {
      say(error);
      return false;
    }
  };

  const removeNetworks = async (/** @type {Network[]} */ list) => {
    const mine = list.filter((n) => !n.builtin);
    if (!mine.length) return false;
    const yes = await app.overlay.confirm({
      title:
        mine.length === 1
          ? `Remove the network ${mine[0]?.name}?`
          : `Remove ${mine.length} networks?`,
      text: mine.some((n) => n.members.length)
        ? "Containers are connected to it: docker refuses until they leave."
        : "Containers that would join it later will not find it.",
      ok: "Remove",
      danger: true,
    });
    if (!yes) return false;
    try {
      await app.docker([
        "network",
        "rm",
        "--",
        ...mine.map((n) => objectRef(n.name, "The network")),
      ]);
      app.toast(
        mine.length === 1 ? `Removed ${mine[0]?.name}.` : `Removed ${mine.length} networks.`,
        "success",
      );
      return true;
    } catch (error) {
      say(error);
      return false;
    } finally {
      reload("networks");
    }
  };

  const pruneNetworks = async () => {
    const unused = app.store.state.networks.filter((n) => !n.builtin && n.members.length === 0);
    if (!unused.length) return app.toast("No network is unused.", "info");
    const yes = await app.overlay.confirm({
      title: `Remove ${unused.length} unused networks?`,
      text: unused.map((n) => n.name).join(", "),
      ok: "Remove unused",
      danger: true,
    });
    if (!yes) return;
    try {
      await app.docker(["network", "prune", "--force"]);
      app.toast("Removed the unused networks.", "success");
    } catch (error) {
      say(error);
    } finally {
      reload("networks");
    }
  };

  /** @param {{ name: string, driver: string, subnet: string, gateway: string, internal: boolean, attachable: boolean }} spec */
  const createNetwork = async (spec) => {
    const args = ["network", "create", "--driver", objectRef(spec.driver, "The driver")];
    if (spec.subnet.trim()) {
      if (!/^[\d.]+\/\d{1,2}$|^[0-9a-fA-F:]+\/\d{1,3}$/.test(spec.subnet.trim())) {
        say(`${spec.subnet} is not a subnet like 172.30.0.0/16.`);
        return false;
      }
      args.push("--subnet", spec.subnet.trim());
    }
    if (spec.gateway.trim()) args.push("--gateway", spec.gateway.trim());
    if (spec.internal) args.push("--internal");
    if (spec.attachable) args.push("--attachable");
    try {
      await app.docker([...args, "--", objectRef(spec.name, "The network")]);
      app.toast(`Created the network ${spec.name}.`, "success");
      reload("networks");
      return true;
    } catch (error) {
      say(error);
      return false;
    }
  };

  const connect = async (
    /** @type {"connect" | "disconnect"} */ verb,
    /** @type {string} */ network,
    /** @type {string} */ container,
  ) => {
    try {
      await app.docker([
        "network",
        verb,
        "--",
        objectRef(network, "The network"),
        objectRef(container),
      ]);
      app.toast(
        verb === "connect"
          ? `Connected ${container} to ${network}.`
          : `Disconnected ${container} from ${network}.`,
        "success",
      );
      return true;
    } catch (error) {
      say(error);
      return false;
    } finally {
      reload("networks", "containers");
    }
  };

  return {
    removeVolumes,
    pruneVolumes,
    createVolume,
    removeNetworks,
    pruneNetworks,
    createNetwork,
    connect,
  };
}
