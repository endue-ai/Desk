# Input methods

`ime.schema.json`. The OS input method (Korean, Japanese, Chinese, dead keys with an IME, emoji
pickers) belongs to the compositor's OS window, but the text lives in the focused surface. So the
compositor relays what the IME composes, and the surface says when it takes text and where its caret
is. Every range counts UTF-16 code units, as the DOM does.

## Messages

| Message | Way | Holds | Means |
| --- | --- | --- | --- |
| `ime.enabled` | surface → compositor | `enabled` | An editable element got the focus (`true`) or none has it (`false`). |
| `ime.caret` | surface → compositor | `caret`, `characters?` | Where the caret is, and each composed character's box while composing. |
| `ime.composition` | compositor → surface | `text`, `underlines`, `selection`, `replacement?` | The text being composed, shown in place until a commit or cancel. |
| `ime.commit` | compositor → surface | `text`, `replacement?` | Text inserted for good; the composition ends. |
| `ime.cancel` | compositor → surface | | The composition is dropped. |

## Flow

Typing 한글 with the Korean IME:

```
surface    ime.enabled { enabled: true }                  a text field got the focus
compositor ime.composition { text: "ㅎ", selection 1–1 }
compositor ime.composition { text: "하", selection 1–1 }
compositor ime.composition { text: "한", selection 1–1 }
surface    ime.caret { caret, characters: [box of 한] }   the candidate window goes under it
compositor ime.commit { text: "한" }
compositor ime.composition { text: "ㄱ" } … ime.commit { text: "글" }
```

- The compositor turns the OS input method on for the focused surface only while it last said
  `ime.enabled: true`, and off when it says `false` or loses the focus. A password field says
  `false`.
- Each `ime.composition` replaces the previous one whole. It is shown in place of the selection, or of
  `replacement` when the IME reconverts text already in the field. `selection` is the caret or the
  selection inside the composed text; `underlines` mark its clauses, `thick` the one being converted.
  The surface draws them in its own theme's colours.
- `ime.commit` ends the composition (if any) and inserts `text` in its place, or in place of
  `replacement`. An empty composition is never sent: the compositor sends `ime.cancel`.
- `ime.caret` is in the surface's logical pixels. The compositor maps it through the window's
  transform to the screen and tells the OS where to put the candidate window. The surface sends it
  when the caret moves while `ime.enabled` is true, and for every composition.
- Keys the IME takes for a composition do not arrive as `key.char`; their `key.down` says `key:
  "Process"` when the OS reports one at all.
