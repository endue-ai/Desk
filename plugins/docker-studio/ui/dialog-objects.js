// Create a volume or a network: the few fields each needs, checked before docker sees them.

import { button } from "./dom.js";
import { check, field, input, select } from "./form.js";

/** @typedef {import("./studio.js").App} App */

/** @param {App} app */
export function openVolumeDialog(app) {
  let name = "";
  let driver = "local";
  const create = button({
    label: "Create",
    icon: "plus",
    kind: "desk-btn-primary",
    onClick: async () => {
      if (await app.objects.createVolume(name.trim(), driver)) dialog.close();
    },
  });
  const dialog = app.overlay.dialog({
    title: "Create a volume",
    subtitle: "Storage docker keeps for containers, apart from any of them",
    icon: "volume",
    body: [
      field(
        "Name",
        input({
          placeholder: "app-data",
          label: "Name",
          onInput: (v) => {
            name = v;
          },
        }),
        "Letters, digits, _ . and -",
      ),
      field(
        "Driver",
        select(
          [["local", "local"]],
          driver,
          (v) => {
            driver = v;
          },
          "Driver",
        ),
        "local keeps it on the engine's disk",
      ),
    ],
    actions: [
      button({ label: "Cancel", kind: "desk-btn-quiet", onClick: () => dialog.close() }),
      create,
    ],
  });
}

/** @param {App} app */
export function openNetworkDialog(app) {
  const spec = {
    name: "",
    driver: "bridge",
    subnet: "",
    gateway: "",
    internal: false,
    attachable: false,
  };
  const create = button({
    label: "Create",
    icon: "plus",
    kind: "desk-btn-primary",
    onClick: async () => {
      if (await app.objects.createNetwork({ ...spec, name: spec.name.trim() })) dialog.close();
    },
  });
  const dialog = app.overlay.dialog({
    title: "Create a network",
    subtitle: "Containers on it reach each other by name",
    icon: "network",
    body: [
      field(
        "Name",
        input({
          placeholder: "backend",
          label: "Name",
          onInput: (v) => {
            spec.name = v;
          },
        }),
      ),
      field(
        "Driver",
        select(
          [
            ["bridge", "bridge (one engine)"],
            ["overlay", "overlay (a swarm)"],
            ["macvlan", "macvlan (the LAN)"],
            ["ipvlan", "ipvlan"],
          ],
          spec.driver,
          (v) => {
            spec.driver = v;
          },
          "Driver",
        ),
      ),
      field(
        "Subnet",
        input({
          placeholder: "172.30.0.0/16, or docker picks",
          mono: true,
          label: "Subnet",
          onInput: (v) => {
            spec.subnet = v;
          },
        }),
      ),
      field(
        "Gateway",
        input({
          placeholder: "172.30.0.1, or the first address",
          mono: true,
          label: "Gateway",
          onInput: (v) => {
            spec.gateway = v;
          },
        }),
      ),
      check("Internal: no way out to the internet", false, (on) => {
        spec.internal = on;
      }),
      check("Attachable: containers outside a swarm service may join", false, (on) => {
        spec.attachable = on;
      }),
    ],
    actions: [
      button({ label: "Cancel", kind: "desk-btn-quiet", onClick: () => dialog.close() }),
      create,
    ],
  });
}
