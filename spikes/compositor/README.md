# Compositor spike (#33 P1 · #34 P2 · #35 P3)

Throwaway code for the PoC of the compositor direction (#32). N off-screen CEF browsers, each its own
renderer process, paint into shared GPU textures; a wgpu compositor imports them and draws them as
tilted quads over a background it draws itself, then reads the composed frame back as PNG. Its own
Cargo workspace, so the repository's gates never build it. It is deleted when `desk-compositor`
(#50) lands; the numbers below live on in the ADR (#40) and #32 §8.

## Run (macOS)

```bash
cargo build --release --bins
cargo run --bin desk-spike-bundle -- target/bundle      # .app with the CEF framework and 5 helpers
# the bundler builds debug binaries; for numbers copy the release ones over them (see run.sh users)
./run.sh 30 /tmp/p1.log --spike-surfaces=1 --spike-page=light --spike-headless \
  --spike-capture=/tmp/p1 --spike-capture-at=3          # PNG of the composed frame
python3 measure.py 10 light 12                          # footprint of every process of the tree
```

Options (`--spike-<name>=<value>`): `surfaces`, `page` (`light` · `heavy` · `webgpu` · `ime`), `view`
(logical WxH, default 800x600), `scale` (2), `frame` (1920x1080), `tilt` (degrees about Y),
`capture`/`capture-at`, `kill-at`, `resize-at`/`resize-to`, `ime`, `headless`, `switch` (a Chromium
switch), `exit-at`. Pages are served on `http://s<n>.localhost:<port>/`: one site per surface, so
`--site-per-process` gives every surface its own renderer, and `*.localhost` is a secure context.

## Results — macOS 26.5.1, Apple M4 Max, CEF 156.0.26 (`cef` crate 156.4.0), wgpu 30, release build

Measured 2026-11-10 with the screen locked, so frames were composed off-screen and checked as PNG
(a locked screen never hands out a drawable; on-screen presentation was not measured).

| Check | Result |
| --- | --- |
| P1 import path | IOSurface → `MTLTexture` → wgpu (`cef::osr_texture_import`), BGRA8, no software paints |
| P1 first paint | 137–248 ms from `CreateBrowser` to the first accelerated paint (1 surface) |
| P1 compose rate | 57–59 fps at 1920x1080 with one animating surface; 55 paints/s from it |
| P1 import cost | 0.45–0.57 ms per paint (copy into an owned texture + wait) |
| P1 resize | `WasResized` → texture 1600x1200 became 2400x1000 for 1200x500 @2x; quad follows |
| P2 WebGPU | works without flags: adapter `apple / metal-3`, not the fallback adapter, `bgra8unorm`, 120+ frames |
| P2 WebGL2 | works: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max)` |
| P3 isolation | `kill -9` of one renderer among 4: CEF reports `TS_PROCESS_WAS_KILLED` in 60 ms, the surface reloads and paints again 50 ms later; the other 3 kept 53 paints/s throughout |
| P3 IME | `ImeSetComposition`/`ImeCommitText` with ㅎ·하·한 · ㄱ·그·글 gives composition events and the value `한글`; the caret rectangle comes back (`OnImeCompositionRangeChanged`) for the candidate window |

Memory (physical footprint per `footprint`, MiB; `light` animates every frame, `heavy` is a static
10,000-row table with 200k objects):

| Surfaces | Page | Total | Browser (our compositor) | GPU process | Renderer each (median) | Other | First paint median / max | Compose fps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | — | 524 | 458 | 26 | — | 41 | — | 59.5 |
| 1 | light | 916 | 481 | 329 | 39 | 41 | 137 / 137 ms | 58.9 |
| 10 | light | 2,002 | 627 | 897 | 41 | 44 | 182 / 217 ms | 58.7 |
| 30 | light | 3,995 | 929 | 1,708 | 43 | 50 | 382 / 464 ms | 51.5 |
| 1 | heavy | 1,209 | 523 | 73 | 547 | 41 | 600 ms | 58.6 |
| 10 | heavy | 6,626 | 991 | 384 | 511 | 44 | 1,005 / 1,032 ms | 57.5 |

Reading it:

- **A fixed cost of ~390 MiB is Apple's GPU driver, not CEF or our code.** The first render pass in a
  process makes the driver hold ~385 MiB on this GPU, whatever the frame size or rate (64x64 → 385,
  4K → 419). A bare Swift program with one empty Metal render pass holds 225 MiB. Every process that
  renders pays it once: our compositor, and CEF's GPU process once it composites.
- **An animating light surface costs ~100 MiB at the margin**: ~42 renderer + ~50 GPU process
  (frame buffers) + ~15 compositor (its imported texture). A static surface costs the renderer and
  little else; content dominates heavy surfaces (~500 MiB for the 10k-row page).
- **The live budget's default N = 8 stands** (#37): 8 animating surfaces ≈ 0.8 GiB over a ~0.9 GiB
  base. Sleeping surfaces (renderer gone) cost only their last frame.
- Chromium keeps one spare renderer warm, hence renderers = surfaces + 1.
- CPU: the GPU process used 4 % with one animating surface and 48 % with ten; each animating
  renderer ~4 %. The browser process shows ~90 % only because the spike polls in a busy loop
  (composing itself took 20 ms of CPU in 4 s).

## Findings the production code must act on

1. **macOS pump**: with `external_message_pump`, calling `do_message_loop_work` when CEF did not ask
   for it blocks ~60 ms per call (13 fps). Calling it only when `OnScheduleMessagePumpWork` says so,
   at most 33 ms apart (cefclient's `kMaxTimerDelay`), gives 57–59 fps. #41 must drive CEF from that
   schedule inside winit's event loop, not from a polling loop.
2. **Import**: `osr_texture_import` allocates a new owned texture and blocks on the GPU for every
   paint. #52 should copy into one persistent texture per surface and fence instead of waiting.
3. **Hidden surfaces must stop painting** (`WasHidden`) and idle ones should run at a lower
   `windowless_frame_rate`: the GPU process grows ~50 MiB per animating surface.
4. **One site per surface** is what makes renderers separate (#36), together with `--site-per-process`.
5. The driver's fixed ~390 MiB per rendering process argues against more rendering processes than
   the two we have (compositor + CEF GPU process); native plugins (#59) that render will pay it too.

## Not done here

Windows (D3D11 shared handle → DX12) and Linux (DMA-BUF → Vulkan, Wayland and X11) were not run: this
session had a Mac only. Run the same commands there (`cargo run --bin desk-spike -- …` directly; no
bundle) and add rows. On Linux try P2 with `--spike-switch=enable-unsafe-webgpu` and
`--spike-switch=enable-features=Vulkan` if `navigator.gpu` is missing. Input other than IME, more than
30 surfaces, and on-screen presentation (locked screen) are also not measured.
