import { idFor, msg, node, profile } from "./model.js";

export function wifi(text) {
  const adapters = profile(text, "SPAirPortDataType").flatMap(
    (r) => r.spairport_airport_interfaces ?? [],
  );
  return adapters
    .filter((r) => r.spairport_status_information)
    .map((r) => {
      const radio = r._name;
      const networks = [];
      const occurrences = new Map();
      const add = (n, joined) => {
        if (!n) return;
        const ssid = n._name;
        const label = !ssid || ssid === "<redacted>" ? msg("wifi.hidden") : ssid;
        const identity = idFor(
          "wifiNetwork",
          radio,
          joined,
          n.spairport_network_bssid ?? ssid,
          n.spairport_network_channel,
        );
        const occurrence = occurrences.get(identity) ?? 0;
        occurrences.set(identity, occurrence + 1);
        networks.push(
          node(idFor(identity, occurrence), label, {
            status: msg(joined ? "wifi.joined" : "wifi.nearby"),
            channel: n.spairport_network_channel,
            signal: n.spairport_signal_noise,
            security: n.spairport_security_mode
              ?.replace(/^spairport_security_mode_/, "")
              .replaceAll("_", " "),
            rate: n.spairport_network_rate,
            phy: n.spairport_network_phymode,
          }),
        );
      };
      add(r.spairport_current_network_information, true);
      for (const other of r.spairport_airport_other_local_wireless_networks ??
        r.spairport_other_local_wireless_networks ??
        [])
        add(other, false);
      return node(
        idFor("wifi", radio),
        radio,
        {
          status: msg(
            r.spairport_status_information === "spairport_status_off" ? "radio.off" : "radio.on",
          ),
        },
        networks,
      );
    });
}

export function bluetooth(text) {
  return profile(text, "SPBluetoothDataType").flatMap((report, index) => {
    const controller = report.controller_properties ?? {};
    const children = [];
    for (const [key, status] of [
      ["device_connected", "radio.connected"],
      ["device_not_connected", "radio.paired"],
    ]) {
      for (const entry of report[key] ?? []) {
        for (const [name, device] of Object.entries(entry)) {
          children.push(
            node(idFor("bluetooth", index, device.device_address ?? name, name), name, {
              status: msg(status),
              address: device.device_address,
              kind: device.device_minorType_string,
              signal: device.device_rssi,
              firmware: device.device_firmwareVersion,
              battery: device.device_batteryLevelMain,
            }),
          );
        }
      }
    }
    if (!Object.keys(controller).length && !children.length) return [];
    return [
      node(
        idFor("bluetooth", index),
        controller.controller_name || msg("bluetooth.adapter"),
        {
          address: controller.controller_address,
          chipset: controller.controller_chipset,
          status: controller.controller_state?.replace(/^attrib_/, ""),
        },
        children,
      ),
    ];
  });
}
