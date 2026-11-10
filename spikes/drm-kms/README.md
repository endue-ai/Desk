# DRM/KMS session spike (#60)

Throwaway code for Stage 3 of #32: can `desk-compositor` own a Linux display directly, with no X11 or
Wayland underneath? `desk-kms` opens a KMS card through the seat, picks a connector and mode, draws
`desk-compositor`'s demo desk (`examples/shared`: drifting, tilting, titled windows in the endue look)
with page flips, reads the pointer and keyboard through libinput and routes them through the
compositor's own `InputRouter`, follows VT switches, and can show one CEF windowless browser as a
plugin window. Its own Cargo workspace, so the repository's gates never build it.

**Verdict.** Nothing has run on a screen yet: this machine is a Mac, with no DRM, no Linux GPU and no
Linux VM to start. That is the blocker for the issue's "video on a bare VT"; #61 is the run. What could
be checked here was: the spike compiles for `x86_64-unknown-linux-gnu`, and links against Debian's
libinput, libudev, libseat and libxkbcommon (and, with CEF, against the real `libcef.so`). Everything
else below is read from the exact sources the spike builds on, or from documentation. Read that way,
the path is open: wgpu 30 has a DRM surface, Mesa's display WSI does atomic page flips (and HDR10), the
seat is a small D-Bus protocol, libinput feeds the compositor's `Input` type unchanged, and prebuilt CEF
runs windowless under Ozone's headless platform. The unknowns are GPU paint for CEF without a display
server, the input method, and what the driver's WSI does across a VT switch.

Legend, used on every claim: **[here]** checked on this machine (compiled, linked, tested or inspected
in the built files); **[source]** read in source code, not run: the exact crates the spike builds on
(wgpu-hal 30.0.1, drm 0.15.0, input 0.10.0, cef 156.4.0) and Mesa and systemd `main` as of 2026-11-10
(a distribution's older Mesa may differ); **[docs]** read in documentation or a third party's report;
**[guess]** an expectation or a judgement for #61 to confirm.

## Files

| File | What it does |
| --- | --- |
| `src/main.rs` | CEF subprocess hand-off first, then `--list` or the session |
| `src/options.rs` | `--present`, `--seat`, `--connector`, `--mode`, `--seconds`, `--capture`, `--cef-*`, ... (`--help`) |
| `src/kms.rs` | drm-rs: cards, connectors, modes, CRTCs, planes, the `--list` report |
| `src/present/vk_display.rs` | wgpu's `SurfaceTargetUnsafe::Drm` (Vulkan `VK_KHR_display`), FIFO presents |
| `src/present/vk_probe.rs` | asks the Vulkan driver which device, modes and display planes the connector has |
| `src/present/dumb.rs` | wgpu off-screen, copy into two KMS dumb buffers, our own modeset and page flips |
| `src/seat/` | `logind.rs` (D-Bus, zbus), `seatd.rs` (libseat), and `direct` (root, no VT switching) |
| `src/input.rs`, `src/keys.rs` | libinput + xkbcommon to `desk_compositor::input::Input`; evdev to DOM codes |
| `src/desk.rs` | the scene, a compositor-drawn pointer, the plugin window, `InputRouter`, `--capture` |
| `src/web.rs`, `src/web_input.rs` | `--features cef`: one windowless browser, its paints, its input |
| `src/session.rs` | the loop: poll, seat events, input, CEF pump, draw, flip |
| `check-in-docker.sh` | compile and link for x86_64 Linux in a Debian container (no display there) |
| `build.rs` | with `cef`: `RUNPATH $ORIGIN`, so the binary finds the `libcef.so` cef-dll-sys copies beside it |

## Checks done here

| Check | Result |
| --- | --- |
| `cargo check --target x86_64-unknown-linux-gnu` on macOS | passes **[here]**: drm-rs, zbus and the sys crates' Rust type-check without any C library |
| `cargo clippy --target x86_64-unknown-linux-gnu --all-targets -- -D warnings`, default features and `--features cef,libseat,typecheck-only` | clean **[here]** (`typecheck-only` skips libseat's pkg-config probe and CEF's download) |
| `cargo test` on macOS | `keys::codes_round_trip` passes **[here]** (the only host-portable module) |
| `check-in-docker.sh udev,libseat` (rust 1.99.1, bookworm, arm64 host cross-linking x86_64) | builds and links **[here]**; the binary needs only `libseat.so.1 libxkbcommon.so.0 libudev.so.1 libinput.so.10` and libc. No libdrm, libgbm or libvulkan: drm-rs makes the ioctls itself, wgpu loads Vulkan at run time |
| `check-in-docker.sh udev,libseat,cef` | downloads `cef_binary_156.0.26+g8ea0c73+chromium-156.0.8078.88_linux64_minimal`, builds the wrapper, compiles `web.rs` and links against `libcef.so` (its own dependencies left unresolved, since they are not installed there) **[here]**; `build.rs` gives the binary `RUNPATH $ORIGIN` so it finds `libcef.so` beside it **[here]** |

What macOS cannot check: `--features udev` (libudev-sys runs pkg-config in its build script) and any
link. The Docker build covers both. Nothing was run: a container cannot open a DRM device either.

## Crates and versions

| Crate | Version | Role | Native library |
| --- | --- | --- | --- |
| `wgpu` (feature `drm`) | 30.0.1 | Vulkan DRM surface; off-screen rendering for the dumb path | `libvulkan.so.1`, loaded at run time |
| `desk-compositor`, `desk-surface` | repo | the scene, chrome, text, `InputRouter`, surface protocol types | none |
| `drm` (drm-rs, Smithay project) | 0.15.0 | KMS ioctls: resources, dumb buffers, `SetCrtc`, `PageFlip`, events | none (pure Rust, rustix) **[here]** |
| `ash` | 0.38.0 | the Vulkan display probe, through wgpu-hal's instance | none |
| `input` (input.rs, Smithay project) | 0.10.0 | libinput: devices, pointer acceleration, scroll sources | `libinput.so.10`; `libudev.so.1` with `udev` |
| `xkbcommon` | 0.9.0 | layouts (RMLVO from `XKB_DEFAULT_*`), keysyms, text | `libxkbcommon.so.0` and `xkb-data` |
| `zbus` | 5.19.0 | logind's D-Bus API | none (pure Rust) |
| `libseat` (Smithay project) | 0.2.4 | seatd, logind or builtin, optional | `libseat.so.1` |
| `cef` | =156.4.0 (CEF 156.0.26) | windowless browser, DMA-BUF import into wgpu | `libcef.so` next to the binary |

## Present paths

**vk-display** (default; `--present=auto` falls back to dumb). wgpu 30's
`SurfaceTargetUnsafe::Drm { fd, plane, connector_id, width, height, refresh_rate }` exists behind the
`drm` feature, Vulkan only **[source]**. wgpu-hal finds the physical device whose
`VkPhysicalDeviceDrmPropertiesEXT` primary or render node equals the fd's `st_rdev`, calls
`vkGetDrmDisplayEXT` and `vkAcquireDrmDisplayEXT` with our fd, picks the Vulkan display mode whose
width, height and millihertz equal ours **exactly**, and creates a `VK_KHR_display` plane surface
**[source]**. Three traps the spike works around, all **[source]**:

- `plane` is a Vulkan display-plane *index*, not a DRM plane id (wgpu-hal's own
  `create_surface_from_drm_plane` mixes the two). `vk_probe.rs` asks
  `vkGetDisplayPlaneSupportedDisplaysKHR` which indices show the connector.
- The refresh must be the driver's number. Mesa computes `clock·1000 / (htotal·vtotal·max(vscan,1))`
  Hz, ·1000, rounded (`wsi_display_mode_refresh`); `kms::refresh_mhz` does the same, and the probe takes
  the driver's nearest mode anyway.
- wgpu-hal `expect`s on a failed acquire, so a refused display panics. The spike catches the unwind to
  fall back to dumb buffers. Mesa accepts our fd if it is DRM master and the same device as its own,
  and refuses a second acquire while one is active **[source]**: one Vulkan instance acquires a
  connector once.

From then on the driver owns KMS: Mesa's display WSI (main) does nonblocking **atomic** commits with
`DRM_MODE_PAGE_FLIP_EVENT`, one per FIFO present **[source]**. Zero copies, but no planes, cursor plane,
VRR or atomic properties of ours. radv and anv list `VK_EXT_acquire_drm_display` when Mesa is built with
its display platform **[source]**, which distributions do **[guess]**; NVIDIA's driver has it too
**[guess]**; lavapipe and virtio-gpu's Venus do not **[guess]**, so a VM without a real GPU takes the dumb
path.

**dumb.** wgpu renders off-screen on whatever adapter exists (lavapipe and llvmpipe included); the frame
is read back and copied row by row into the back one of two `XRGB8888` dumb buffers (`Bgra8Unorm`
bytes are XRGB8888's in memory); the first frame is `drmModeSetCrtc`, the rest `drmModePageFlip` with an
event we wait for on the card's fd (`present/dumb.rs`, compiled **[here]**, drm-rs calls **[source]**).
Legacy KMS on purpose: dumb buffers and legacy flips are the lowest common denominator of KMS drivers,
virtio-gpu and simpledrm included **[guess]**. One CPU copy per frame (8 MB at 1080p), so it shows
correctness, not performance. On exit it restores the CRTC it found.

**Production path (not in the spike).** GBM buffer objects allocated with the scanout modifiers the
plane advertises (`IN_FORMATS`), exported as DMA-BUF, imported into Vulkan
(`VK_EXT_external_memory_dma_buf` + `VK_EXT_image_drm_format_modifier`, both of which wgpu-hal 30 knows
**[source]**), wrapped as wgpu textures through wgpu-hal, rendered by `desk-compositor` (it draws into
any `TextureView`), committed with atomic KMS by us. That is what owning planes, the cursor plane,
VRR, HDR metadata, multi-monitor pacing and hotplug requires; the CEF surface import (#61) uses the same
DMA-BUF machinery in the other direction.

## Session and seat

A display server on a VT does not open `/dev/dri/card*` or `/dev/input/event*` itself. The session
manager hands out fds, makes the card's fd DRM master while the session is in front, and revokes evdev
fds and drops master when the person switches VT **[docs]**. Three seats, `--seat=`:

- **logind** (default; zbus, pure Rust). `Manager.GetSession($XDG_SESSION_ID)` (or `GetSessionByPID`),
  `Session.TakeControl(false)`, `TakeDevice(major, minor) → (fd, inactive)` per node, `ReleaseDevice`,
  the `PauseDevice(major, minor, "pause"|"force"|"gone")` and `ResumeDevice(major, minor, fd)` signals,
  `PauseDeviceComplete` to acknowledge a `"pause"`, `Seat.SwitchTo(vt)` **[docs]** (logind's D-Bus
  API page). It needs a session with a seat and a VT: a text-console login, not SSH; the spike checks
  `VTNr` and says so.
- **libseat** (`--features libseat`): one library over seatd, logind or its builtin backend
  (`LIBSEAT_BACKEND`); Smithay's session backend is libseat (`backend_session_libseat` in its manifest
  **[source]**), as are wlroots' and sway's **[guess]**. With seatd it also works from SSH (`seatd-launch`)
  **[guess]**.
- **direct**: open the nodes as root on a VT nobody else draws on. No pause, no VT switching.

## VT switching

- logind's `TakeControl` sets the session's VT to `K_OFF` (no kernel keyboard), `KD_GRAPHICS` and
  `VT_PROCESS` (`session_prepare_vt`) **[source]**, so Ctrl+Alt+F<n> is the compositor's job. xkb's
  default keymap turns Ctrl+Alt+F<n> into the keysyms `XF86Switch_VT_<n>` **[guess]**; the spike maps
  those to `SwitchTo(n)` (`keys::switch_vt`, tested **[here]**).
- Away: on `PauseDevice` for the card the spike stops presenting, suspends libinput (which releases the
  evdev nodes through the seat) and acknowledges. Back: `ResumeDevice`, libinput resumes (`TakeDevice`
  again, new fds), and the next frame is a full modeset (dumb) or a new swapchain (vk-display).
- vk-display across a switch is the weak spot **[source]**: if a present hits `EACCES` without master,
  Mesa marks the swapchain `VK_ERROR_SURFACE_LOST_KHR`; recreating the surface means acquiring the
  display again, which the same instance refuses. A real session on that path would rebuild the
  instance and device after every lost switch. Pausing before acknowledging (as the spike does) may
  avoid the loss; #61 finds out.
- A safety net is needed while developing: if input fails nothing can switch VT. Keep SSH open
  (`pkill desk-kms`), and the spike quits after `--seconds` (30 by default).

## Input

libinput's path backend opens every `/dev/input/event*` through the seat (`--features udev` uses udev
seat assignment and input hotplug instead). Relative motion moves a pointer the compositor draws
itself; absolute motion (tablets, QEMU's `usb-tablet`) maps onto the mode; buttons `BTN_LEFT..EXTRA`;
wheel in v120 units as lines, finger scrolling in pixels; keys through xkb (evdev + 8) into DOM
`code` and `key` and the typed text (compiled **[here]**; what libinput and xkb report is **[source]**,
from the crates' APIs, not run).
Every event becomes `desk_compositor::input::Input`, the type the shells already feed to
`InputRouter` (ADR 0150), so hit testing, focus, the keymap and the surface protocol messages are the
compositor's own, unchanged. Missing for a real session: key repeat (a timer of ours, from
`xkb_keymap_key_repeats`), the hardware cursor plane, touchpad settings, layouts from the desk's settings,
and the **input method**: with no Wayland or X11 there is no `text-input` and no XIM, so Korean input
needs the desk to be an ibus or fcitx5 client over D-Bus, feeding `Input::Ime` **[guess]**.

## Multi-monitor, HDR, hotplug

- **Multi-monitor.** One CRTC per connector, one buffer set per output, each flipping on its own
  vblank; `desk-compositor` already draws several scenes with one `Compositor`, one per display
  **[source]** (its README). The spike drives one output (`--connector`). vk-display does not scale to
  two outputs as wgpu stands: Mesa allows one active acquire per Vulkan instance and wgpu acquires for
  every DRM surface **[source]**, so a second connector needs a second instance, hence a second device
  whose textures the first cannot sample. Several outputs means our own KMS. Needed besides: a layout of
  outputs, a scale per output, and pacing per CRTC.
- **HDR.** Mesa's display WSI (main) offers `A2B10G10R10` + `HDR10_ST2084` when the EDID says the
  display does PQ, and sets the connector's `HDR_OUTPUT_METADATA` and `Colorspace` in its atomic commit,
  with metadata from the EDID unless `vkSetHdrMetadataEXT` says otherwise **[source]**. wgpu 30 maps
  `SurfaceColorSpace::Bt2100Pq` to `HDR10_ST2084_EXT` **[source]** but never calls
  `vkSetHdrMetadataEXT` **[source]**, so the EDID defaults would apply. vk-display prints the surface's
  formats and `display_hdr_info()`; `--list` prints which connectors have the HDR properties and which
  planes take 10-bit or fp16 formats. On our own KMS path HDR is ours to do: those two properties, `max
  bpc`, a 10-bit or fp16 buffer, and colour management in the compositor's shaders.
- **Hotplug.** The kernel sends a udev `change` event with `HOTPLUG=1` on the card **[guess]**; the
  compositor re-reads connectors (`get_connector(.., force_probe)`) and adds or drops outputs. With
  vk-display that means a new instance per new connector (the acquire trap above); on our own KMS it is
  an ordinary modeset. Input hotplug comes with libinput's udev backend (`--features udev`). The spike
  handles neither.

## CEF without X11 or Wayland

- Chromium's Ozone layer picks the platform at run time (`--ozone-platform=`); headless is one of them,
  documented as "no GPU support; software rendering only" **[docs]** (Chromium's
  `docs/ozone_overview.md`). The DRM/GBM platform (GPU process doing GBM and KMS itself) is in production
  on ChromeOS **[docs]**, and CEF's Linux build does not have it: `libcef.so` names source paths under
  `ui/ozone/platform/` for `headless`, `wayland` and `x11` only **[here]**.
- Prebuilt CEF now runs windowless under headless Ozone: ROOT's CEF display switched to it in June 2026
  with `--ozone-platform=headless --disable-gpu --use-gl=swiftshader --enable-unsafe-swiftshader` and
  `windowless_rendering_enabled` **[docs]** (root-project/root#22594). The spike starts CEF with
  `--ozone-platform=headless` and software paints (`OnPaint`, BGRA uploaded into a texture); `--cef-switch`
  adds ROOT's switches or GPU ones, and `--cef-shared-texture` asks for `OnAcceleratedPaint` DMA-BUFs that
  the `cef` crate imports into our Vulkan device (it needs `VULKAN_EXTERNAL_MEMORY_DMA_BUF`, which
  vk-display requests) **[source]**. Whether any GPU path (shared textures, WebGPU, WebGL on the GPU)
  works under headless Ozone is the biggest unknown **[guess]: probably not without a patch**; the
  alternatives are a desk-provided Wayland socket for Chromium's GPU process, or building CEF with the
  DRM platform.
- `libcef.so` (CEF 156.0.26, Chromium 156.0.8078.88) links the X11 client libraries even when no X
  server exists **[here]**: it needs glib, gobject, gio, NSPR, NSS (nss3, nssutil3,
  smime3), ATK, atk-bridge, AT-SPI, D-Bus, CUPS, X11, Xcomposite, Xdamage, Xext, Xfixes, Xrandr, xcb,
  xkbcommon, GBM, expat, Cairo, Pango, udev and ALSA. A bare session installs those libraries, not a
  display server. The distribution is 1.5 GB extracted (`libcef.so` alone 1.4 GB, unstripped) and brings
  its own `libvulkan.so.1` and SwiftShader (`libvk_swiftshader.so`) but no `libEGL.so`/`libGLESv2.so`
  **[here]**. With `RUNPATH $ORIGIN`, wgpu's `dlopen("libvulkan.so.1")` may pick CEF's copy of the
  Khronos loader instead of the system's **[guess]**; both read the system's ICDs.
- Subprocesses are this binary (`execute_process` first in `main`, before the seat or the card is
  touched). The spike runs unsandboxed (`no_sandbox`); the real desk needs `chrome-sandbox` setuid or
  unprivileged user namespaces, as ADR 0148 does elsewhere.
- Input reaches the browser through the router's surface protocol messages (`web_input.rs`, a reduced
  copy of the CEF shell's `web_host/input.rs`); CEF on Linux reads `native_key_code` as an XKB keycode
  **[guess]**.

## Is Smithay the base?

Partly, and it already is: drm-rs, input.rs and libseat-rs are Smithay-project crates. For the
production output path, Smithay 0.7's `backend` modules (`session::libseat`, `udev`, `drm` with atomic
and legacy surfaces, `allocator::gbm`) encode years of KMS edge cases and are worth taking whole
**[guess]**. Its renderers (GLES, Pixman, Vulkan bits) are not ours: we render with wgpu, and its
`DrmCompositor` (plane assignment) wants a Smithay `Renderer`, so we would either write that trait for
wgpu or keep plane assignment ourselves. Its `wayland_frontend` matters only if the desk ever hosts
other Linux apps (a terminal, native apps) as Wayland clients: that is a product decision, and it is
also the cleanest way to give Chromium a display. Version skew to watch: Smithay 0.7 is on drm 0.14 and
input 0.9; wgpu 30 is on drm 0.15 (they share only raw fds, so it does not block).

## Estimate for a real session

One person, after #61 confirms the paths; **[guess]** throughout:

| Work | Weeks |
| --- | --- |
| Own KMS: GBM + DMA-BUF import into wgpu, atomic commits, modifiers, the cursor plane | 3–4 |
| Seat, VT switching, hotplug, several outputs with layout and scale | 2–3 |
| Input: key repeat, layouts and touchpad settings from the desk, gestures | 2 |
| Input method over D-Bus (ibus or fcitx5), Korean first | 2–3 |
| CEF: software paint under headless Ozone (days); GPU paint without a display server | 1–4, or a CEF patch |
| A session entry for display managers, crash fallback to the console, logs | 1 |
| HDR and VRR | 2–3, later |

About 3–4 months to a desk that is a usable session with web plugins. Hosting other Linux apps
(Wayland clients, XWayland) is separate, and larger.

## Risks

1. **GPU paint for CEF without a display server.** Headless Ozone is documented as software-only; WebGPU
   (goal 5 of #32) on a bare session may need a desk-provided Wayland socket or a patched CEF.
2. **The driver's WSI owns KMS on vk-display.** No planes or atomic properties of ours, one output per
   Vulkan instance, and a VT switch may lose the swapchain for good. The production path is our own KMS.
3. **Driver coverage.** `VK_EXT_acquire_drm_display` is radv and anv **[source]** and probably NVIDIA
   **[guess]**; VMs without a GPU fall back to the dumb path's CPU copy. NVIDIA's GBM and modifiers are
   the usual pain on our own KMS **[guess]**.
4. **No input method** on a bare VT until the desk speaks ibus or fcitx5 over D-Bus.
5. **Accessibility.** No AT-SPI bus consumer and no screen reader integration without a desktop;
   AccessKit's Linux adapter speaks AT-SPI, which needs a session bus and Orca **[guess]**.
6. **Lock-out while developing.** A compositor that stops reading input leaves the VT unswitchable; keep
   SSH and `--seconds`.
7. **CEF's footprint on a minimal system.** `libcef.so` pulls X11, GTK-adjacent (ATK, Pango, Cairo),
   CUPS, ALSA and NSS libraries even with no X server.

## For #61: what a person with a Linux machine runs

A spare box with an Intel or AMD GPU (Mesa) is best. A VM works for the dumb path (QEMU
`-device virtio-vga` or `virtio-gpu-pci`; add a `usb-tablet` for an absolute pointer).

1. Packages (Debian 13 or Ubuntu 24.04+): `sudo apt install build-essential pkg-config libinput-dev
   libudev-dev libseat-dev libxkbcommon-dev xkb-data mesa-vulkan-drivers vulkan-tools`; Fedora:
   `sudo dnf install gcc pkgconf libinput-devel systemd-devel libseat-devel libxkbcommon-devel
   mesa-vulkan-drivers vulkan-tools`. Rust 1.99 through rustup.
2. Build: `cd spikes/drm-kms && cargo build --release --features udev,libseat`.
3. Keep a way in: SSH from another machine, ready to run `pkill desk-kms`.
4. Switch to a free VT (Ctrl+Alt+F3) and log in on the text console. Check
   `loginctl show-session "$XDG_SESSION_ID" -p Type -p VTNr -p Active` says `tty`, a VT number and
   `yes`. A display manager on another VT can stay.
5. `./target/release/desk-kms --list | tee list.txt`: cards, connectors, modes, planes, what Vulkan says
   per connector, and the wgpu adapters. Also `vulkaninfo | grep -i -E 'acquire_drm|KHR_display'`.
6. Dumb path: `./target/release/desk-kms --present=dumb --seconds=30 --capture=/tmp/kms-dumb.png 2>&1 |
   tee dumb.log`. Expect the demo desk; move the pointer, click, type (`--verbose` prints every input
   event). Ctrl+Alt+F2 then Ctrl+Alt+F3 must leave and come back to a working desk.
7. vk-display: `./target/release/desk-kms --present=vk-display --seconds=30
   --capture=/tmp/kms-vk.png 2>&1 | tee vk.log`, then the same VT switch. Note the flips per second and
   compose times the log prints every two seconds.
8. Seats: repeat 6 with `--seat=libseat` (`LIBSEAT_BACKEND=logind`), and from SSH with seatd
   (`sudo seatd-launch -- ./target/release/desk-kms --seat=libseat --present=dumb --seconds=20`).
9. Korean layout and keys: `XKB_DEFAULT_LAYOUT=kr ./target/release/desk-kms --verbose --seconds=20`;
   check the Hangul and Hanja keys arrive as `Lang1` and `Lang2`.
10. CEF: install libcef's libraries (`libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1
    libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libdbus-1-3 libatspi2.0-0`; some
    have a `t64` suffix on Ubuntu 24.04; `ldd target/release/libcef.so | grep 'not found'` must print
    nothing), build with `--features udev,libseat,cef` (downloads CEF's 1.5 GB Linux distribution once),
    then run, each for 30 s:
    - `--cef-url=https://example.com` (software paint, headless Ozone);
    - the same plus ROOT's `--cef-switch=disable-gpu --cef-switch=use-gl=swiftshader
      --cef-switch=enable-unsafe-swiftshader`;
    - `--present=vk-display --cef-shared-texture --cef-switch=use-angle=vulkan` and a WebGPU page.
    Click into the page and type: the router's messages must reach it. The log prints software and
    accelerated paint counts.
11. Record: a phone video of steps 6, 7 and 10 on the screen, the `--capture` PNGs, `list.txt` and the
    logs. Then the report on #61: which present path, which seat, flips per second, what the VT switch
    did on each path, which CEF variant painted, and every error line.
