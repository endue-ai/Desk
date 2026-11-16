// What macOS 26's own programs print, in the shape captured on a Mac mini (route, ifconfig, arp -an,
// ping -q, dig over mDNS, system_profiler SPAirPortDataType -json), with made-up addresses: the
// network is 192.168.0.0/24, the router 192.168.0.1, this computer 192.168.0.10.

export const ROUTE = `   route to: default
destination: default
       mask: default
    gateway: 192.168.0.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>
 recvpipe  sendpipe  ssthresh  rtt,msec    rttvar  hopcount      mtu     expire
       0         0         0         0         0         0      1500         0
`;

export const ROUTE_NONE = "route: writing to routing socket: not in table\n";

export const IFCONFIG = `en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	options=6460<TSO4,TSO6,CHANNEL_IO,PARTIAL_CSUM,ZEROINVERT_CSUM>
	ether f0:d1:a9:10:00:0a
	inet6 fe80::1c2f:aa11:2233:4455%en0 prefixlen 64 secured scopeid 0xb
	inet 192.168.0.10 netmask 0xffffff00 broadcast 192.168.0.255
	nd6 options=201<PERFORMNUD,DAD>
	media: autoselect (1000baseT <full-duplex>)
	status: active
`;

export const IFCONFIG_PUBLIC = IFCONFIG.replace(
  "inet 192.168.0.10 netmask 0xffffff00 broadcast 192.168.0.255",
  "inet 203.0.113.10 netmask 0xffffff00 broadcast 203.0.113.255",
);

export const IFCONFIG_WIDE = IFCONFIG.replace(
  "inet 192.168.0.10 netmask 0xffffff00 broadcast 192.168.0.255",
  "inet 192.168.0.10 netmask 0xffff0000 broadcast 192.168.255.255",
);

/** arp -an: leading zeros left out, an incomplete entry, broadcast, multicast and another interface. */
export const ARP = `? (192.168.0.1) at 0:a:eb:1:2:3 on en0 ifscope [ethernet]
? (192.168.0.10) at f0:d1:a9:10:0:a on en0 ifscope permanent [ethernet]
? (192.168.0.21) at b8:27:eb:aa:bb:cc on en0 ifscope [ethernet]
? (192.168.0.23) at 0:bc:99:12:34:56 on en0 ifscope [ethernet]
? (192.168.0.31) at 3c:5a:b4:0:11:22 on en0 ifscope [ethernet]
? (192.168.0.42) at 6a:1f:2e:3d:4c:5b on en0 ifscope [ethernet]
? (192.168.0.50) at (incomplete) on en0 ifscope [ethernet]
? (192.168.0.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]
? (224.0.0.251) at 1:0:5e:0:0:fb on en0 ifscope permanent [ethernet]
? (169.254.4.118) at a0:ad:9f:22:e0:8e on en1 [ethernet]
? (10.0.5.2) at 1c:1b:d:df:18:d on en1 ifscope [ethernet]
`;

export const pingReply = (ms: number) => `PING 192.168.0.1 (192.168.0.1): 56 data bytes

--- 192.168.0.1 ping statistics ---
1 packets transmitted, 1 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = ${ms}/${ms}/${ms}/0.000 ms
`;

export const PING_NONE = `PING 192.168.0.99 (192.168.0.99): 56 data bytes

--- 192.168.0.99 ping statistics ---
1 packets transmitted, 0 packets received, 100.0% packet loss
`;

export const PING_LINE = "64 bytes from 192.168.0.1: icmp_seq=0 ttl=64 time=3.412 ms\n";

export const DIG_NAME = "Studio-iMac.local.\n";
export const DIG_NONE =
  ";; communications error to 224.0.0.251#5353: timed out\n;; no servers could be reached\n";

/** system_profiler SPAirPortDataType -json, without Location Services: every SSID redacted. */
export const WIFI = JSON.stringify({
  SPAirPortDataType: [
    {
      spairport_airport_interfaces: [
        {
          _name: "en1",
          spairport_status_information: "spairport_status_connected",
          spairport_current_network_information: {
            _name: "<redacted>",
            spairport_network_channel: "6 (2GHz, 20MHz)",
            spairport_network_phymode: "802.11n",
            spairport_network_rate: 144,
            spairport_security_mode: "spairport_security_mode_wpa2_personal",
            spairport_signal_noise: "-58 dBm / -92 dBm",
          },
          spairport_airport_other_local_wireless_networks: [
            net("6 (2GHz, 20MHz)", "wpa2_personal", "-48 dBm / -92 dBm"),
            net("6 (2GHz, 20MHz)", "wpa2_personal", "-52 dBm / -92 dBm"),
            net("5 (2GHz, 20MHz)", "wpa2_personal_mixed", "-60 dBm / -92 dBm"),
            net("7 (2GHz, 40MHz)", "wpa2_personal"),
            net("1 (2GHz, 20MHz)", "wpa3_personal", "-62 dBm / -92 dBm"),
            net("44 (5GHz, 80MHz)", "wpa2_personal", "-61 dBm / -92 dBm"),
            net("157 (5GHz, 80MHz)", "wpa2_personal", "-70 dBm / -92 dBm"),
            net("97 (6GHz, 160MHz)", "wpa3_personal", "-75 dBm / -92 dBm"),
            net("153 (5GHz, 80MHz)", "none"),
          ],
        },
        { _name: "awdl0" },
      ],
    },
  ],
});

function net(channel: string, mode: string, signal?: string) {
  return {
    _name: "<redacted>",
    spairport_network_channel: channel,
    spairport_network_phymode: "802.11a/n/ac/ax",
    spairport_network_type: "spairport_network_type_station",
    spairport_security_mode: `spairport_security_mode_${mode}`,
    ...(signal ? { spairport_signal_noise: signal } : {}),
  };
}

/** The same report with Location Services on: the names are there. */
export const WIFI_NAMED = WIFI.replace('"<redacted>"', '"Home"').replace(
  '"<redacted>"',
  '"Neighbour 2G"',
);

export const WIFI_OFF = JSON.stringify({
  SPAirPortDataType: [
    {
      spairport_airport_interfaces: [
        { _name: "en1", spairport_status_information: "spairport_status_off" },
      ],
    },
  ],
});

/** A small OUI table: the lines assets/oui.txt holds for these prefixes. */
export const OUI = [
  "000AEB\tTP-Link",
  "00BC99\tHangzhou Hikvision Digital",
  "3C5AB4\tGoogle",
  "B827EB\tRaspberry Pi Foundation",
  "F0D1A9\tApple",
].join("\n");
