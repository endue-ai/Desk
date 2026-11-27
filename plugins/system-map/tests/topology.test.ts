import { expect, it } from "vitest";
import { snapshot } from "../ui/topology.js";

const reports = {
  hardware: JSON.stringify({
    SPHardwareDataType: [{ machine_name: "Test Mac", chip_type: "Apple M4" }],
  }),
  battery:
    "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1) 72%; discharging; 3:30 remaining",
  thermal: "CPU_Speed_Limit = 85",
  interfaces:
    "en0: flags=8863<UP,RUNNING> mtu 1500\n\tinet 192.0.2.2 netmask 0xffffff00\nutun1: flags=8051<UP,POINTOPOINT> mtu 1280",
  vpn: '* (Connected) 00000000-0000-0000-0000-000000000001 VPN (com.example.vpn) "Office" [VPN:com.example.vpn]',
  peers: "? (192.0.2.3) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]",
  wifi: JSON.stringify({
    SPAirPortDataType: [
      {
        spairport_airport_interfaces: [
          {
            _name: "en0",
            spairport_status_information: "spairport_status_on",
            spairport_current_network_information: {
              _name: "Office Wi-Fi",
              spairport_network_channel: "44 (5GHz, 80MHz)",
            },
          },
        ],
      },
    ],
  }),
  bluetooth: JSON.stringify({
    SPBluetoothDataType: [
      {
        device_connected: [
          { Headphones: { device_minorType_string: "Headphones", device_rssi: "-60" } },
        ],
      },
    ],
  }),
  processes:
    " 42  1.2  4096 /Applications/Browser.app/Contents/MacOS/Browser\n 77  0.0  2048 /Applications/Editor.app/Contents/MacOS/Editor",
  sockets:
    "p42\ncBrowser\nf9\nPTCP\nn127.0.0.1:4000\nTST=LISTEN\nf10\nPTCP\nn192.0.2.2:54444->203.0.113.1:443\nTST=ESTABLISHED\nf11\nPTCP\nn*:8080\nTST=LISTEN\n",
};

it("joins observed endpoints to their app and keeps idle apps, radios and sensors visible", () => {
  const root = snapshot(reports);
  const data = JSON.stringify(root);
  for (const name of [
    "Test Mac",
    "Apple M4",
    "72%",
    "85",
    "utun1",
    "Office",
    "192.0.2.3",
    "Office Wi-Fi",
    "Headphones",
    "Editor",
  ])
    expect(data).toContain(name);
  const apps = root.children.find((node) => node.id === "apps");
  const browser = apps?.children.find((node) => node.label === "Browser");
  expect(JSON.stringify(browser)).toContain("203.0.113.1:443");
  const listeners = JSON.stringify(
    root.children
      .find((node) => node.id === "network")
      ?.children.find((node) => node.id === "listeners"),
  );
  expect(listeners).toContain("scope.loopback");
  expect(listeners).toContain("scope.wildcard");
});

it("distinguishes unavailable observations from a successful empty result", () => {
  const data = JSON.stringify(snapshot({ ...reports, bluetooth: "bad json", vpn: "" }));
  expect(data).toContain("status.unavailable");
  expect(data).toContain("status.empty");
  expect(data).toContain("Office Wi-Fi");
});
