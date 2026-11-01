# Tauri single-instance, Desk's maintained platform fixes

This is published `tauri-plugin-single-instance` 2.5.5 with a narrow Linux zbus 6 port.
Windows source, public `init`/`Builder`/`destroy` API and optional features retain upstream behavior.
macOS binds the single-instance socket before setup returns, even when the async executor is busy.
`NOTICE` records provenance and local changes; `LICENSE-APACHE` and `LICENSE-MIT` are upstream texts.

The official Tauri 2 release still depends on zbus 5's discontinued standalone type crates.
Linux uses the same private session-bus name, object path and `ExecuteCallback(argv, cwd)` method.
A primary holds the connection until cleanup; a secondary exits successfully only after delivery
is acknowledged. If the observed owner disconnects during delivery, a new primary may be elected
without replaying that delivery. A missing bus permits launch; live-owner errors remain errors.
No path is read or granted authority here. Desk validates delivered arguments in its OS adapter.

| Path | Responsibility |
| --- | --- |
| `src/lib.rs`, `src/semver_compat.rs` | Upstream public API and feature behavior |
| `src/platform_impl/windows.rs` | Unchanged published platform implementation |
| `src/platform_impl/macos.rs` | Socket ownership established synchronously during setup |
| `src/platform_impl/linux.rs`, `src/linux_bus.rs` | Linux app integration and owned async bus lifetime |
| `tests/` | Lifecycle, macOS startup readiness and private D-Bus delivery/error regressions |

`just check-app` runs app-native and vendored-plugin tests. Linux tests use a private
`dbus-run-session`; a missing daemon is a failed prerequisite, never a silent skip.
The standalone bus tests also run against an isolated `dbus-daemon` without a desktop.

Remove the vendor once a stable official Tauri 2 compatible release adopts maintained zbus and
passes these checks. Keep `deny.toml` unchanged; verify the old zbus 5 dependency chain is absent.
