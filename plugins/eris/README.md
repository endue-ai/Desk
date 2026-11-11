# plugins/eris

Eris, the secretary. Built-in UI plugin in the community folder format.

| Path | Purpose |
| --- | --- |
| `ui/index.html`, `ui/main.js` | The Eris surface: one status pose (idle, listening, thinking, done, heads-up, oops); the `state` command switches it |
| `ui/talk.js` | Talking to her (`brain:converse`): the typed line rises into her centre, the answer streams back as soul text under her while it is short (over 120 characters the history alone shows it), the offline line while the brain is unreachable (ADR 0014); Stop, in Send's place while she answers, or Escape in the field, stops waiting |
| `ui/conversation.js` | Selectable conversation history; last 50 messages survive SDK frame reloads without replaying requests |
| `ui/context.js` | Explicit saved-file attachment from open text buffers; exact-path read permission, 16 KiB read and 3,000-character excerpt limits, removable before Send |
| `ui/soul-text.js` | Soul text: per-character timing from word start times (900 ms in, 35 ms apart, 1.6 s out with seeded 0–450 ms jitter), wisp, solemn and reduced styles, `wordsFromText` when there are no voice timestamps |
| `ui/orb.js` | The orb: core of light, body and Dysnomia, assembled on a timeline (full, arrival, quick 1.2 s, reduced); gestures: listen, flash, turn, shrink, heads-up (the gold face lifts) |
| `ui/voice.js` | Her voice: a female English system voice (Web Speech API), or silence when there is none or the browser is automated; soul text keeps its own timing |
| `ui/timeline.js` | Paused Web Animations positioned from an injected clock (ADR 0013); holding none and no cue, it asks for no frame and its time stands still (#134) |
| `ui/soul-text.css` | Shared styles for soul text and the orb: her words in the theme's roles (her gold is `chart-3`), her body over the brand art in the theme's `eris*` tokens, which the shell's Eris reads too |
| `ui/assets/` | Copies of `brand/eris/*.svg` (brand licence) |
| `tests/` | Timing rules (vitest), the asset copies, and `theme.test.ts`: every colour, font, size, radius and duration comes from the theme's `--desk-*` tokens |

Other plugins reuse the soul text and the orb by importing them from this folder, for example the
onboarding plugin's import map maps `eris/` to `../../endue.eris/ui/`.

The manifest declares the floating Eris's settings (ADR 0121), read by the app: `endue.eris.float`
(`auto`, floating over other apps while the desk is not in front; `always`; `never`) and
`endue.eris.shortcut` (`Alt+Enter`, ⌥↩ on macOS; `DESK_ERIS_SHORTCUT` overrides it), set in init.yaml.

Attach open text file uses the saved file; unsaved edits are excluded. Its visible excerpt is sent
only with the next message, up to the bridge's 8,000-character message limit. Failed sends retain
the question. Conversation history is local SDK frame state, not account history or model memory;
answers over 20,000 characters display a labelled excerpt in the history. No model tools execute.
Stop ends the window's wait and drops the rest of that turn; the bridge has no call that stops the
brain's turn itself.

```bash
pnpm exec vitest run plugins/eris
cargo run -p desk-cli -- plugin validate plugins/eris
```
