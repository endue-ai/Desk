# Lifecycle

`lifecycle.schema.json`. A surface is made, shown and hidden, put to sleep and woken, and destroyed by
the compositor, which decides from the window manager and the live budget (#32 §8). The surface says
when it is ready, when it died, and its title.

```
            create ──► shown ◄──show / hide──► hidden
                         │                       │
                         └──── sleep ──► asleep ◄┘ ──wake──► shown
            any state ── died ──► dead ──wake──► shown
            any state ── destroy ──► gone
```

## Compositor → surface

| Message | Holds | Means |
| --- | --- | --- |
| `create` | `surface`, `plugin`, `view`, `size`, `scale`, `format`, `hidden?` | Make the surface and draw `view` (a `surfaces` id of `plugin`'s manifest; `plugin` is `desk` for the desk's system surfaces). It starts shown unless `hidden`. `format` is the texture format the compositor wants. |
| `resize` | `size`, `scale` | Lay out at a new logical size or scale (a resize, a move to another display). |
| `show` | | On screen again: paint at the last `pace`. |
| `hide` | | Off screen (`WasHidden`): stop painting; keep running and keep its state. |
| `sleep` | | Out of the live budget: save the state, stop painting, and let the process exit. |
| `wake` | `size`, `scale` | Start again at this size (a new process if there is none), restore the saved state, paint. |
| `destroy` | | Closed for good: free everything. Nothing about the surface follows from either side. |

## Surface → compositor

| Message | Holds | Means |
| --- | --- | --- |
| `ready` | | Loaded and takes input. Once after `create`, once after each `wake`; frames may come before it. |
| `died` | `reason`, `exitCode?` | The process ended while not asleep: `crashed`, `killed`, `out-of-memory`, `launch-failed` or `exited`. |
| `title` | `title` | The title for the window's chrome and the switchers (a page's `document.title`). |

## Rules

- **Who speaks for a surface.** The surface's *host* sends its messages: the web host for a CEF
  browser, the native host's socket for a native plugin. `died` always comes from a host, because the
  dead process cannot send it: the web host turns the engine's signal into it, and the desk's native
  host sends it when the plugin's process exits. A hang is not a death: the desk finds it with
  `desk:ping` (#32 §9).
- **Sizes.** `size` is logical; the texture is `size × scale`, rounded. Until a frame of the new pixel
  size arrives after `resize` or `wake`, the compositor draws the last frame anchored at the top left,
  cropped or padded, and never stretched.
- **Hidden.** A hidden surface attaches no frames whatever its `pace`, and hears no pointer input. It
  keeps its process and state; the compositor keeps its last frame for thumbnails and the minimap.
- **Asleep.** After `sleep` the process may exit, and that exit is not a `died`. Its textures may go
  with it: the compositor copies the last frame before releasing it, or keeps its import, whose memory
  outlives the producer on every OS. The window shows that frame, greyed, until `wake`.
- **Dead.** After `died` the compositor shows a placeholder with *Reload*. `wake` starts the surface
  again with its saved state; the desk does so once by itself, and quarantines a plugin whose surface
  dies twice in a minute (#32 §9). `destroy` ends it instead.
- **Releases end with the process.** After `sleep`, `died` or `destroy` the compositor sends no
  `release` for frames still held; a host that outlives its process frees them itself.
