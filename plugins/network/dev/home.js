// A made-up home network for the preview: what macOS's programs would print on it, which ports its
// devices answer on, and what the plugin would have kept from earlier days. Every address is fake.

export const DEVICES = [
  { ip: "192.168.0.1", mac: "0:a:eb:1:2:3", ms: 2.1, open: [53, 80, 443] },
  { ip: "192.168.0.10", mac: "f0:d1:a9:10:0:a", ms: 0, self: true },
  {
    ip: "192.168.0.12",
    mac: "f0:d1:a9:22:33:44",
    ms: 6.4,
    mdns: "Studio-MacBook-Air",
    open: [22, 5900],
  },
  { ip: "192.168.0.21", mac: "b8:27:eb:aa:bb:cc", ms: 3.9, mdns: "raspberrypi", open: [22, 8080] },
  { ip: "192.168.0.23", mac: "0:bc:99:12:34:56", ms: 142, open: [23, 80, 554] },
  { ip: "192.168.0.30", mac: "0:0:f0:5a:6b:7c", ms: 11, mdns: "Samsung-TV", open: [8001] },
  { ip: "192.168.0.31", mac: "3c:5a:b4:0:11:22", ms: 24 },
  {
    ip: "192.168.0.40",
    mac: "0:1:e6:40:40:40",
    ms: 8.8,
    mdns: "HP-LaserJet-M110",
    open: [80, 631, 9100],
  },
  { ip: "192.168.0.42", mac: "6a:1f:2e:3d:4c:5b", ms: 48 },
  { ip: "192.168.0.44", mac: "9e:55:12:ab:cd:ef", ms: 61, mdns: "Minas-iPad" },
  { ip: "192.168.0.51", mac: "0:4:3c:aa:10:20", ms: 14, mdns: "Sonos-Living" },
  { ip: "192.168.0.77", mac: "0:4b:12:7e:8f:90", ms: 230 },
];

export const route = () => `   route to: default
destination: default
    gateway: 192.168.0.1
  interface: en0
`;

export const ifconfig =
  () => `en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	ether f0:d1:a9:10:00:0a
	inet 192.168.0.10 netmask 0xffffff00 broadcast 192.168.0.255
	status: active
`;

export const arp = () =>
  `${DEVICES.map((d) => `? (${d.ip}) at ${d.mac} on en0 ifscope${d.self ? " permanent" : ""} [ethernet]`).join("\n")}\n? (192.168.0.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]\n`;

/** @param {string} ip */
export const ping = (ip) => {
  const d = DEVICES.find((x) => x.ip === ip);
  if (!d || d.self)
    return {
      code: 2,
      out: `--- ${ip} ping statistics ---\n1 packets transmitted, 0 packets received, 100.0% packet loss\n`,
    };
  return {
    code: 0,
    out: `--- ${ip} ping statistics ---\n1 packets transmitted, 1 packets received, 0.0% packet loss\nround-trip min/avg/max/stddev = ${d.ms}/${d.ms}/${d.ms}/0.000 ms\n`,
  };
};

/** @param {string} ip */
export const dig = (ip) => {
  const d = DEVICES.find((x) => x.ip === ip);
  return d?.mdns
    ? { code: 0, out: `${d.mdns}.local.\n` }
    : { code: 9, out: ";; no servers could be reached\n" };
};

/** @param {string} host @param {number} port */
export const isOpen = (host, port) =>
  DEVICES.find((d) => d.ip === host)?.open?.includes(port) ?? false;

const net = (
  /** @type {string} */ channel,
  /** @type {string} */ mode,
  /** @type {number} */ rssi,
  name = "<redacted>",
) => ({
  _name: name,
  spairport_network_channel: channel,
  spairport_network_phymode: "802.11a/n/ac/ax",
  spairport_security_mode: `spairport_security_mode_${mode}`,
  spairport_signal_noise: `${rssi} dBm / -92 dBm`,
});

/** @param {boolean} names */
export const wifi = (names) =>
  JSON.stringify({
    SPAirPortDataType: [
      {
        spairport_airport_interfaces: [
          {
            _name: "en0",
            spairport_status_information: "spairport_status_connected",
            spairport_current_network_information: {
              ...net("6 (2GHz, 20MHz)", "wpa2_personal", -58, names ? "Home" : "<redacted>"),
              spairport_network_rate: 144,
            },
            spairport_airport_other_local_wireless_networks: [
              net("6 (2GHz, 20MHz)", "wpa2_personal", -49, names ? "Apt 301" : "<redacted>"),
              net("6 (2GHz, 20MHz)", "wpa2_personal", -55, names ? "KT_GiGA_2G" : "<redacted>"),
              net("5 (2GHz, 20MHz)", "wpa2_personal_mixed", -63, names ? "iptime" : "<redacted>"),
              net("7 (2GHz, 40MHz)", "wpa2_personal", -70, names ? "U+Net4A21" : "<redacted>"),
              net("1 (2GHz, 20MHz)", "wpa3_personal", -66, names ? "Cafe" : "<redacted>"),
              net(
                "11 (2GHz, 20MHz)",
                "wpa2_personal",
                -86,
                names ? "Printer-DIRECT" : "<redacted>",
              ),
              net("44 (5GHz, 80MHz)", "wpa2_personal", -61, names ? "Apt 301 5G" : "<redacted>"),
              net("157 (5GHz, 80MHz)", "wpa2_personal", -72, names ? "KT_GiGA_5G" : "<redacted>"),
              net("100 (5GHz, 160MHz)", "wpa3_personal", -80, names ? "Home 5G" : "<redacted>"),
              net("37 (6GHz, 160MHz)", "wpa3_personal", -75, names ? "Neighbour 6E" : "<redacted>"),
            ],
          },
        ],
      },
    ],
  });

const day = (/** @type {number} */ d, /** @type {number} */ h) =>
  new Date(Date.UTC(2026, 10, 17 - d, h)).toISOString();

/** What the plugin kept before today, when the person already said they run the network. */
export const kept = {
  devices: {
    "00:0a:eb:01:02:03": { ip: "192.168.0.1", first: day(9, 1), last: day(1, 9) },
    "f0:d1:a9:10:00:0a": {
      ip: "192.168.0.10",
      first: day(9, 1),
      last: day(1, 9),
      name: "Mac mini",
      mine: true,
      known: true,
    },
    "f0:d1:a9:22:33:44": {
      ip: "192.168.0.12",
      first: day(9, 1),
      last: day(1, 9),
      name: "MacBook Air",
      mine: true,
      known: true,
      kind: "laptop",
    },
    "00:00:f0:5a:6b:7c": {
      ip: "192.168.0.30",
      first: day(9, 1),
      last: day(1, 9),
      name: "Living room TV",
      known: true,
      kind: "tv",
    },
    "6a:1f:2e:3d:4c:5b": {
      ip: "192.168.0.42",
      first: day(6, 3),
      last: day(1, 9),
      name: "Mina's iPhone",
      known: true,
      mine: true,
      kind: "phone",
    },
    "00:01:e6:40:40:40": { ip: "192.168.0.40", first: day(8, 2), last: day(1, 9), known: true },
    "00:04:3c:aa:10:20": { ip: "192.168.0.51", first: day(5, 2), last: day(1, 9), known: true },
    "b8:27:eb:aa:bb:cc": { ip: "192.168.0.21", first: day(4, 2), last: day(3, 9), gone: true },
    "00:bc:99:12:34:56": {
      ip: "192.168.0.23",
      first: day(3, 6),
      last: day(1, 9),
      name: "Living room camera",
      known: true,
      kind: "camera",
    },
    "3c:5a:b4:00:11:22": { ip: "192.168.0.31", first: day(2, 6), last: day(1, 9) },
  },
  log: [
    { kind: "first", at: day(9, 1), count: 7 },
    { kind: "new", at: day(6, 3), mac: "6a:1f:2e:3d:4c:5b", ip: "192.168.0.42" },
    { kind: "new", at: day(4, 2), mac: "b8:27:eb:aa:bb:cc", ip: "192.168.0.21" },
    { kind: "new", at: day(3, 6), mac: "00:bc:99:12:34:56", ip: "192.168.0.23" },
    { kind: "gone", at: day(3, 9), mac: "b8:27:eb:aa:bb:cc", ip: "192.168.0.21" },
    { kind: "new", at: day(2, 6), mac: "3c:5a:b4:00:11:22", ip: "192.168.0.31" },
  ],
};
