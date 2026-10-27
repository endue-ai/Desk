# plugins/eris

Eris, the secretary. Built-in UI plugin in the community folder format.

| Path | Purpose |
| --- | --- |
| `ui/index.html`, `ui/main.js` | The Eris surface: one status pose (idle, listening, thinking, done, heads-up, oops); the `state` command switches it |
| `ui/soul-text.js` | Soul text: per-character timing from word start times (900 ms in, 35 ms apart, 1.6 s out with seeded 0–450 ms jitter), wisp, solemn and reduced styles, `wordsFromText` when there are no voice timestamps |
| `ui/orb.js` | The orb: core of light, body and Dysnomia, assembled on a timeline (full, quick 1.2 s, reduced) |
| `ui/timeline.js` | Paused Web Animations positioned from an injected clock (ADR 0013) |
| `ui/soul-text.css` | Shared styles for soul text and the orb |
| `ui/assets/` | Copies of `brand/eris/*.svg` (brand licence) |
| `tests/` | Timing rules (vitest) and the asset copies |

Other plugins reuse the soul text and the orb by importing them from this folder, for example the
onboarding plugin's import map maps `eris/` to `../../endue.eris/ui/`.

```bash
pnpm exec vitest run plugins/eris
cargo run -p desk-cli -- plugin validate plugins/eris
```
