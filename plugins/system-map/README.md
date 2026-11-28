# System map

Open **System map** from the launcher, then choose **Read system**. On macOS the plugin takes a
local snapshot of hardware, battery and thermal readings, interfaces and VPN services, Wi-Fi,
Bluetooth, USB device trees, published hardware sensors, neighbor caches, sockets and running applications. Select a row for its fields.
Select a branch to expand or collapse it. Refresh takes a new snapshot and keeps the selection
while its item is present. English and Korean catalogs follow the Desk language.

The Network branch shows TCP listeners, peer connections and bound UDP sockets. The Applications
branch groups processes by their enclosing application bundle and shows their observed sockets by
PID. Other executables have a separate branch. Reports reflect the current user's OS visibility.
Interfaces include tunnel adapters even when their provider is absent from the VPN service list.
Neighbor caches can contain stale entries. Bind scope describes local addresses. Firewall, NAT and
routing determine external reachability. Sensors vary with hardware, driver and OS permissions.

Collection uses the scoped process bridge with fixed argument arrays. The page holds observations
in memory until the next refresh or close. The launcher command is `endue.system-map.open`.

Run `pnpm exec vitest run plugins/system-map` and `just test-e2e e2e/system-map.spec.ts`.
