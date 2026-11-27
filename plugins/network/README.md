# plugins/network

`endue.network`, Network: who is on the network this computer is on, how safe it is and why it is slow,
in the community folder format on the public SDK only (ADR 0266). Off until opened (`autoload`); one
surface with four tabs: **Map** (the router in the middle, each device around it with its IP address,
MAC address, manufacturer, ping and status as a shape, a word and a colour; "Who is this?"), **Checkup**
(a score out of 100, cards of what to do, each device's open ports), **Wi-Fi channels** (2.4, 5 and 6
GHz apart, congestion with overlap, a recommended channel), **Log** (new, returning and departing
devices on the universal timeline). Words are `messages/en.json` and `ko.json`; the design is
`docs/ko/network-plugin-requirements.md` (NET-xx, NF-xx).

Only the private network (RFC 1918) the computer is on; public and other ranges are refused in code
(`ipv4.js`). macOS's own programs by full path, arguments as arrays, no shell (`run.js`): `arp -an`,
`ping`, `route -n get default`, `ifconfig`, `dig` over mDNS, `system_profiler SPAirPortDataType`.
Nothing is swept before the person says they administer the network (asked once per network); a network
wider than /24 shows its ARP table only. Port checks use the fixed port list, send no data and close
immediately. One lasting review covers the selected devices and their exact addresses (ADR 0382).

| Permission | Why |
| --- | --- |
| `proc:spawn` (six programs by path) | The ARP table, pings, the default route, the interface, mDNS names, the Wi-Fi report |
| `net:connect` (`*`, declared) | An explicit scope for the fixed check ports on one known device or the batch |
| `ui:notify` · `brain:ask` | Say a new device joined; "Explain simply" with kind, manufacturer and ports only |

| Files | Purpose |
| --- | --- |
| `ipv4.js` · `parse.js` · `wifi.js` · `oui.js` · `run.js` · `probe.js` | Addresses, the programs' output, the runner, one look |
| `devices.js` · `kinds.js` · `layout.js` · `ports.js` · `checkup.js` · `channels.js` · `journal.js` | The models |
| `network.js` · `app.js` · `commands.js` · `explain.js` · `store.js` · `refusal.js` | Controller, page state, commands, brain, store, refusals |
| `view*.js` · `labels.js` · `dom.js` · `icons.js` · `*.css` | The DOM, from `--desk-*` tokens only |
| `assets/oui.txt` · `dev/` | The IEEE OUI registry (`dev/make-oui.mjs`); a preview on a made-up network |

```bash
pnpm exec vitest run plugins/network
node plugins/network/dev/serve.mjs   # http://localhost:4351/ui/index.html?admin=yes&lang=ko
cargo run -p desk-cli -- plugin validate plugins/network
```
