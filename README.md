# endue

English · [日本語](docs/i18n/ja/README.md) · [中文](docs/i18n/zh/README.md) ·
[Français](docs/i18n/fr/README.md) · [Deutsch](docs/i18n/de/README.md) · [한국어](docs/i18n/ko/README.md)

One app that is one OS.

**No fixed screens.** endue is a Rust shell on Chromium and a small Rust core with a web runtime on top, and every
feature above that, the built-in ones included, is a plugin you can replace while the app is running.
Like Emacs: the core keeps only primitives (files, processes, network, audio, windows), and everything
else is code you can change without restarting.

> Status: pre-alpha. `just dev` opens the desk with Eris and the first run; start `just brain-echo` first and she answers what you type (an echo for now).

<!-- Screenshot: added with the first-run scene. -->

## Install or upgrade the endue app

The current [endue 0.4.0 release](https://github.com/endue-ai/endue/releases/tag/v0.4.0) has macOS disk images for Apple silicon and Intel. For a new installation, verify the image against `SHA256SUMS-macos` and copy `endue.app` into Applications. Follow the steps below to upgrade an existing Desk installation.

endue is the graphical app formerly called Desk. The [v0.3.0 download](https://github.com/endue-ai/endue/releases/tag/v0.3.0) provides macOS disk images for Apple silicon (`aarch64`) and Intel (`x86_64`). Compare the SHA-256 of your Mac’s disk image with `SHA256SUMS-macos` on the release page, then open the image and copy endue Desk into Applications. Apple did not notarize v0.3.0. If macOS blocks the verified app’s first launch, select **Open Anyway** for endue Desk under System Settings → Privacy & Security.

- On macOS, quit Desk, mount the new `.dmg` and open `Install endue.command`. The installer updates an existing copy in Applications by its bundle ID, even if you renamed it. If you have several copies or another app named endue, open Terminal in the mounted image and run `"./Install endue.command" --to "/Applications/Studio.app"` with your chosen path. Select your existing Desk copy or an available filename.
- On Windows or Linux, use the same package type as your installed copy when that package is listed. Windows keeps the existing installation directory. Debian continues to track the package as `endue-desk`.
- Reopen the app. Your profiles and `plugins.lock` stay in `~/.desk`. The app also keeps its existing settings, grants and credential references. An installer-only Desk release such as v0.3.0 upgrades manually with the installer.

The official command is `endue`. Try it from a source checkout with `cargo run -p desk-cli -- --help`. The v0.3.0 disk images predate the bundled CLI. Existing scripts can keep using `desk` throughout the current major release line.

### Linux x86_64 servers

Download `endue-cli_0.4.0_linux-x86_64.tar.gz` and `SHA256SUMS-cli` from the [v0.4.0 release](https://github.com/endue-ai/endue/releases/tag/v0.4.0) into an empty directory. Run `sha256sum -c SHA256SUMS-cli`, then `tar -xzf endue-cli_0.4.0_linux-x86_64.tar.gz`. Set `ENDUE_BRAIN_URL` to your brain v0 service and run `./endue-cli_0.4.0_linux-x86_64/bin/endue run "hello"`. [Verification for signed CLI releases](docs/releasing.md#verify-a-linux-cli-download)

## Why endue

Picture a builder's garage: one room where the builder works in the middle, an assistant remembers and
asks, robot arms do the work, and every wall shows the work in the shape the builder wants. endue is that
garage, on your computer.

- **A daily tool.** Builders open it every day, so it installs, starts and answers before it does anything
  else.
- **Agent-native.** Eris, the resident secretary, keeps her own memory on this computer and orchestrates
  local and external agents. Agents have hands; the person decides.
- **Views first.** Organise data once and draw it in any shape: make your own view, let Eris make one from
  a sentence, or install one from the market.
- **Yours.** The design system, the layout and the integrations are the builder's to choose and replace.

endue is a helper for builders: it sets up a stable environment to build in, leaves them free to shape it,
and lets them make the best product at a quality that does not waver. Where endue stands and where it goes
is in `docs/roadmap.md`.

### Your desk is a folder

Everything you shape lives in `~/.desk`: `init.yaml`, your profiles, `keys.yaml`, your views and
`plugins.lock`, plain files you can read, edit and keep in git. `endue export <folder|file.zip>` carries
them to another computer (`--with-data` adds the desk's own state, never secrets), `endue import` brings
them back without overwriting your `init.yaml`, and `endue doctor` lists every file with whether it reads
as its spec says.

## Build

```bash
pnpm install
just check && just test
just dev
```

You need Rust (the version is pinned in `rust-toolchain.toml`), Node 22+, pnpm, `just`, and cmake and
ninja for the app's Chromium (CEF), which its first build downloads; on Linux also the GTK 3, xdo,
AppIndicator and ALSA headers. The runtime tests run in headless Chromium of the app's own version,
which `just test-e2e` fetches once into `~/.cache/desk`. Run them with `just test-e2e`, never with
Playwright directly.

## Privacy

endue has no telemetry. Crash reports, when they arrive, are opt-in and off by default.

## Learn more

- `docs/architecture.md`: how the layers fit together
- `docs/adr/`: decisions that are hard to reverse, and why
- `docs/roadmap.md`: why endue exists, where it stands and where it goes
- `AGENTS.md`: the repository map, commands and rules (for people and AI agents)
- `CONTRIBUTING.md`: how to send a change

## License

Code is licensed under [Apache-2.0](LICENSE). The endue and Eris names, logos and illustrations in
`brand/` are not: see [brand/LICENSE](brand/LICENSE) and [TRADEMARK.md](TRADEMARK.md).
