# Input, cursor, and drag and drop

`input.schema.json` and `drag.schema.json`. The compositor owns the OS window, so it hears every
input event first. It hit-tests its scene top down, through each window's transform, and sends the
event to the surface under the pointer (or with the keyboard focus) in that surface's own logical
pixels. Its own chrome and overlays take the pointer only while they are active (a drag, a menu).

## Pointer

| Message | Holds |
| --- | --- |
| `pointer.move` | `x`, `y`, `buttons` (held), `modifiers` |
| `pointer.down` | `x`, `y`, `button`, `buttons`, `clicks`, `modifiers` |
| `pointer.up` | `x`, `y`, `button`, `buttons`, `clicks`, `modifiers` |
| `pointer.wheel` | `x`, `y`, `deltaX`, `deltaY`, `unit` (`pixel`, `line`, `page`), `modifiers` |
| `pointer.leave` | |

- Buttons are `left`, `middle`, `right`, `back` and `forward`; `buttons` lists the ones held after the
  event. `clicks` counts quick presses in one place by the OS's double-click time: 2 is a double click.
- A press captures the pointer: until its button goes up, moves and the release go to the surface
  that took the press, wherever the pointer is, so `x` and `y` may fall outside the surface.
- Wheel deltas are signed as the DOM's `WheelEvent`: positive `deltaY` scrolls toward the end
  (down), positive `deltaX` toward the right. `pixel` deltas are logical pixels.
- `pointer.leave` comes when the pointer leaves the surface or something the compositor draws above
  it takes it.

## Keyboard and focus

| Message | Holds |
| --- | --- |
| `key.down` | `key`, `code`, `modifiers`, `repeat` |
| `key.up` | `key`, `code`, `modifiers` |
| `key.char` | `text`, `modifiers` |
| `focus.in`, `focus.out` | |

- One surface at most has the keyboard focus; keys and IME go to it alone. It hears `focus.out` when
  the focus moves to another surface, to the compositor's chrome, or to another app.
- `key` and `code` are the DOM's `KeyboardEvent.key` and `.code`: `key` is the meaning under the
  layout (`a`, `Enter`, `Dead`), `code` the physical key (`KeyA`, `Enter`). `repeat` marks the OS's
  auto-repeat.
- `key.char` carries the text a press types after the layout and dead keys (`é`), after its
  `key.down`. Text an IME composes comes as `ime.commit` instead (`ime.md`).
- Keys the compositor keeps for itself (its own shortcuts) never reach a surface.
- Modifiers are `shift`, `ctrl`, `alt`, `meta` (Command on macOS, Windows or Super elsewhere) and
  `caps-lock` (the lock being on), each at most once.

## Cursor

`cursor` (surface → compositor) holds a `SurfaceCursor`: `{ kind: "named", name }` with a CSS cursor
keyword (`pointer`, `text`, `col-resize`, `none` hides it), or `{ kind: "image", png, hotspotX,
hotspotY, scale }` for a cursor the surface draws (a base64 PNG of 256 × 256 pixels at most, hotspot in
its pixels). The compositor sets it while the pointer is over the surface and none of its own chrome
or overlays has it.

## Drag and drop

ADR 0119's broker, run by the compositor rather than the web runtime. It carries the same desk data:
`desk/paths` (absolute bridge paths, with `kind: file | folder` when known), `desk/text`, `desk/uri`
(never `javascript:`), `desk/json` with a lowercase `kind` (offered as `desk/json:<kind>`) and
`text/plain`, which the compositor makes from the other items when the source gives none. A drag
offers each type at most once and is 4 MiB at most; its image is a PNG, JPEG, GIF or WebP data URL.

| Message | Way | Holds | Means |
| --- | --- | --- | --- |
| `drag.accept` | surface → compositor | `types` | The types this surface's targets take; `desk/json` alone takes every kind. |
| `drag.start` | source → compositor | `items`, `effectAllowed`, `image?` | Start a drag of desk data. |
| `drag.enter` | compositor → target | `x`, `y`, `types`, `effectAllowed`, `modifiers`, `from` | A drag came over; `types` is the offered types it accepts. |
| `drag.over` | compositor → target | `x`, `y`, `modifiers` | It moved, or the keys changed. |
| `drag.status` | target → compositor | `effect` | The answer to the last enter or over: `copy`, `move`, `link` or `none`. |
| `drag.leave` | compositor → target | | It left, or was cancelled over it. |
| `drag.drop` | compositor → target | `x`, `y`, `effect`, `items` | It landed, with the agreed effect and the items of the types it accepts. |
| `drag.done` | target → compositor | `effect` | The effect performed, or `none`. |
| `drag.ended` | compositor → source | `effect`, `to?` | How the drag ended and which plugin took it. |

- **A person's gesture.** The compositor takes `drag.start` only while a press on that surface is
  held: it owns the input, so a surface cannot start a drag by itself. From then on the compositor
  owns the pointer, draws the drag image with the answered effect (`+` copy, `↗` link, `⊘` refused)
  above every window, and hit-tests the targets itself.
- **Nothing to those who cannot take it.** A surface hears `drag.enter` only when it accepts one of
  the offered types (`drag.accept`), and receives the items only in `drag.drop`, only of the types it
  accepts. `from` names the source plugin, `os` for a drop from the operating system, `desk` for the
  desk's own.
- **The target decides.** By default Alt copies, Mod (Meta or Ctrl) moves and both link, as Finder
  does; otherwise the target's preference wins. On release the compositor waits up to 400 ms for the
  answer to the last hover, and drops only on an effect. A drag from the OS allows `copy` and `link`,
  never `move`.
- **A drop hands over paths and data, not access.** Receiving `desk/paths` grants nothing; reading or
  changing a dropped path still goes through `fs.*` under the target's own grants (ADR 0029).
- Unlike the frames of ADR 0119, a drag can now cross every window the compositor draws, system
  surfaces included, with no shield: the compositor already holds the pointer.
