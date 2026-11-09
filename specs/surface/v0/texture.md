# Textures and frames

`texture.schema.json`. A surface draws into shared GPU textures and hands each frame to the
compositor with `attach`; the compositor imports a texture once, samples it, and gives it back with
`release`. The only part of the protocol that differs per OS is the texture handle.

## Messages

| Message | Way | Holds | Means |
| --- | --- | --- | --- |
| `attach` | surface → compositor | `frame`, `texture`, `damage`, `release`, `fenceFdIndex?` | A new frame is in `texture`; `damage` says what changed. |
| `release` | compositor → surface | `frame`, `fenceFdIndex?` | The compositor is done reading that frame's texture. |
| `pace` | compositor → surface | `fps` (1–240) | The most frames per second the surface may attach. |
| `rate` | surface → compositor | `fps` (0–240) | How often the surface means to paint: 0 only on change, 60 while animating. |

## Texture handles

`SurfaceTexture` is `{ id, generation, width, height, format, handle }`. `id` names one of the
producer's textures (it may rotate two or three); `generation` counts the allocations behind that id
(a resize makes a new one). The compositor imports a texture the first time it sees an `id` and
`generation`, and samples that import for every later frame that names them: one import, many frames.

| `handle.kind` | OS | Holds | The compositor |
| --- | --- | --- | --- |
| `iosurface` | macOS | `id` (IOSurfaceID), `portIndex?` | wraps it as a Metal texture; across processes the Mach send right (`IOSurfaceCreateMachPort`) travels out of band at `portIndex`, and `id` checks it |
| `d3d11` | Windows | `handle`, `keyedMutex` | opens the NT shared handle on its D3D11/D3D12 device; `handle` is the value in the sending process, which the compositor duplicates (it started that process) |
| `dmabuf` | Linux | `fourcc`, `modifier`, `planes[]` (`fdIndex`, `stride`, `offset`) | imports a Vulkan image from the planes' fds, on Wayland and X11 alike |

`bgra8` is DRM `AR24` (`XR24` when opaque) and `rgba8` is `AB24` (`XB24`). `modifier` is a hexadecimal
string because it needs 64 bits: `0x0` is linear. A layout whose modifier has auxiliary planes
(compression) brings up to four planes; most bring one.

## Acquire and release

1. **The producer finishes writing, then attaches.** Before `attach`: on macOS its GPU work is
   committed and complete; on Windows it releases the keyed mutex with key 1 (with `keyedMutex`), or
   flushes and waits (without); on Linux it either gives a `sync_file` fd at `fenceFdIndex` that
   signals when its writes are done, or relies on the DMA-BUF's implicit sync.
2. **The compositor owns the texture until `release`.** The producer does not write it in between.
   With `keyedMutex` the compositor acquires key 1 to read and releases with key 0.
3. **`release` says when.** `after-copy`: the compositor copies the damage into a texture of its own
   and releases at once, before it composes; for a producer whose texture is valid only briefly (an
   engine's paint callback, a pool of one). `when-replaced`: the compositor samples the texture itself
   and releases it when a later frame replaces it on screen; zero-copy, so a producer needs two
   textures, three never to wait.
4. **Every `attach` gets exactly one `release`**, in frame order, unless the surface sleeps, dies or
   is destroyed first. On Linux the release may carry a `sync_file` at `fenceFdIndex` that signals when
   the compositor's reads are done; the producer waits on it before writing.
5. **Imports belong to one process's life.** When a surface wakes in a new process, the compositor
   drops every import of the old one at the first new frame; ids and generations may start over.

## Damage and pacing

- `damage` lists what changed since the surface's previous frame, in texture pixels, inside the
  texture: one to 32 rectangles, and a whole-texture change is one rectangle that covers it. A texture
  the compositor has not imported yet, or a frame of a new size, counts as wholly damaged. A
  compositor that copies (`after-copy`) updates only the damage; every compositor redraws only the
  part of the screen it covers.
- A surface attaches only when something changed: no damage, no frame. The compositor redraws only
  when a surface attached or its own chrome changed, so a still desk costs no GPU time.
- `pace` caps the rate: the display's while the window is in front, lower in the background (the
  engine's windowless frame rate for web surfaces). A hidden surface paints nothing whatever its pace
  (`hide`, `lifecycle.md`).
- `rate` is the surface's own plan, which the compositor uses to schedule its frames and to weigh
  the live budget: an animating surface costs more to keep live than a still one.
