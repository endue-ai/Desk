---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# The CEF desk runs its subprocesses in Chromium's sandbox, macOS first

## Context and Problem Statement

The CEF desk gives every plugin surface a renderer of its own (ADR 0140) and keeps a plugin to the
bridge, whose every call the core checks (ADR 0012). That boundary holds only if the renderer cannot
reach the system itself, yet the shell set CEF's `no_sandbox: 1` until the helpers were packaged
(#46, ADR 0145). Measured on that build: every renderer, the GPU process and the network and storage
services ran unsandboxed, and the kernel let each of them read and write a file in `HOME`. A plugin
that broke out of V8 ran with the desk's rights. When and how does the sandbox go on, on each OS?

## Decision Drivers

* A plugin's renderer reaches the person's files, the desk's data and the network only through the bridge
* Fail closed: a subprocess that cannot enter the sandbox does not run
* Each OS's sandbox is proven on that OS before the desk runs with it there
* The proof comes from outside the processes, as the kernel sees them, and fails with the sandbox off

## Considered Options

* On for macOS now; Linux and Windows behind `no_sandbox` until a machine proves them (#61)
* On for every OS at once
* Off until Stage 2's off-screen surfaces

## Decision Outcome

Chosen option: "on for macOS now", because macOS is where it can be proven today, a sandbox switched on
untested would either break the desk on start or give a false sense of safety, and Stage 2 changes how
surfaces draw, not what a renderer may touch.

* **macOS.** `no_sandbox` is 0 (`apps/desk/shell/src/sandbox.rs`). The browser process starts every
  helper with `--seatbelt-client`; the helper calls CEF's `cef_sandbox_initialize` in
  `libcef_sandbox.dylib` (through the `cef` crate's `cef::sandbox`) before it loads the framework, as
  CEF's own helpers do, and exits when it cannot. The library ships inside the framework's
  `Libraries`, which the packaged build signs with the framework (ADR 0145); since CEF made its macOS
  sandbox a dynamic library there is nothing to link. Renderers get Chromium's renderer profile, the
  GPU process and the utilities theirs.
* **Entitlements** stay as ADR 0145 set them. With the sandbox on, Chromium 156 still starts the GPU
  process from the base `Helper` (the `(GPU)` helper stays unused), so the base Helper keeps
  `allow-jit` for SwiftShader; the seatbelt needs no entitlement of its own.
* **Linux** (#61): the zygote's namespace sandbox needs unprivileged user namespaces, which Ubuntu
  23.10 and later grant only through AppArmor, or the set-uid `chrome-sandbox`, which neither a
  cargo-packager `.deb` nor an AppImage can carry. The `.deb` installs an AppArmor profile for
  `/usr/lib/endue-desk-cef/endue-desk-cef`; the AppImage relies on user namespaces; a desk that finds
  neither does not start (Chromium's "No usable sandbox"), rather than run without.
* **Windows** (#61): CEF 156 sandboxes only an app built as a client DLL that CEF's `bootstrap.exe`
  loads (`CEF_USE_BOOTSTRAP`); the desk becomes `endue-desk-cef.dll` (a `cdylib` exporting the entry
  point the bootstrap calls) beside `bootstrap.exe` renamed `endue-desk-cef.exe`, which loads the DLL
  of its own name, as the `cef` crate's `sandbox` feature lays it out; the installers and
  Authenticode signing take both.
* **Its own command line** (#104). A release build drops the switches that weaken isolation
  (`sandbox::WEAKENING`: `--no-sandbox`, `--disable-gpu-sandbox`, `--disable-web-security`,
  `--disable-site-isolation-trials`, `--single-process`, `--in-process-gpu`,
  `--remote-debugging-port`, `--remote-debugging-pipe`) from the browser process's command line,
  each with a line on stderr. It drops them in CEF's `on_before_command_line_processing`, which
  hands over the command line as Chromium parsed it, after CEF has added what its settings ask for
  and before Chromium reads a switch or copies one to a subprocess: so on every OS, in every form
  Chromium accepts (`-no-sandbox`, `/no-sandbox` on Windows). Where the sandbox waits for #61, CEF
  itself sets `--no-sandbox` from `no_sandbox`, and it stays. A development build keeps them all for
  debugging; the shell opens DevTools only through `DESK_REMOTE_DEBUGGING_PORT`, there.
* **Proof.** `e2e/specs/sandbox.spec.ts` asks the kernel, with `sandbox_check(3)`, whether each
  renderer, the GPU process and each sandboxed utility has a sandbox and may read or write a file in
  `HOME` and the desk's data folder (no; the desk's own process may), and runs a plugin's bridge call,
  own files, WebAssembly, worker, WebGPU compute pass and `fs.url` Range read in its renderer.

### Consequences

* Good, because a renderer that is taken over can read, write or connect nowhere but through the bridge.
* Good, because the check is the kernel's answer from outside, and it is red on the build without the sandbox.
* Bad, because Linux and Windows desks keep their renderers unsandboxed until #61, and Windows' plan
  reshapes the binary (a DLL behind CEF's bootstrap).
* Good, because no launcher, shortcut or pasted command starts a release desk without its sandbox or
  its site isolation, or with DevTools open to the machine, as one can start Chrome (#104).
* Bad, because that stops mistakes and lures, not an attacker: whoever can start the desk with
  arguments already runs code as the person. A development build still honours every switch.
* Bad, because the app e2e needs a C compiler (`cc`) on macOS for its probe.

## More Information

Epic #32 §1, §9 and §12; ADR 0012 (plugins and the bridge), ADR 0140 (a renderer per surface), ADR
0143 (the shell), ADR 0145 (helpers and entitlements). CEF: `include/cef_sandbox_mac.h`. Linux and
Windows procedure: `docs/releasing.md`, "The CEF desk".
