# desk-image-studio

Raster editing engine for the Image Studio plugin. `Image` owns straight-alpha RGBA pixels.
`Document` applies atomic edit batches, owns the undo and redo history and exports PNG. The
WebAssembly exports provide buffers and exchange commands as JSON with the plugin worker.

```bash
cargo test -p desk-image-studio
node scripts/image-studio-wasm.mjs
```
