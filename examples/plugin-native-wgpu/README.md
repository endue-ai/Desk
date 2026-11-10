# examples/plugin-native-wgpu

The smallest native plugin (kind `native`, #59, ADR 0154): a Rust program that the desk starts as a
process of its own. It reads one setting of its own over the bridge (`settings.get` of `speed`, which
needs no permission), says hello, and draws a turning triangle with wgpu into an IOSurface that it
attaches to its surface, at the desk's pace, while its window is shown. A click changes the colour.
It answers the desk's pings from the loop that draws, keeps its angle when it sleeps and gets it back
when it wakes, and exits when the desk closes its connection.

## Run it

```bash
just example plugin-native-wgpu
```

The recipe builds the program, puts it at `bin/<os>-<arch>/` where `plugin.json` names it, and runs
the desk in compositor mode with this folder as a dev plugin. Its window moves, snaps and sleeps like
any other; `kill -9` its process and only its window says so, then loads again. Rebuild it while the
desk runs (`node scripts/example.mjs build plugin-native-wgpu`) and the desk starts the new program.

## Files

| File | Purpose |
| --- | --- |
| `plugin.json` | The manifest: kind `native`, a program per platform, one surface, one setting |
| `src/main.rs` | Start and exit; frames reach the desk on macOS until #61 |
| `src/mac.rs` | The loop: the desk's messages in, frames out, its page messages, its one bridge call |
| `src/shown.rs` | When to draw: shown, at the desk's pace, after the last frame came back |
| `src/scene.rs`, `src/scene.wgsl` | The wgpu scene |
| `tests/desk.rs` | The built program against a desk the test plays (macOS) |

## Check it

```bash
cargo test -p plugin-native-wgpu
```

On Linux and Windows the program builds and says that frames from another process reach the desk on
macOS only until #61 imports DMA-BUFs and D3D11 handles.
