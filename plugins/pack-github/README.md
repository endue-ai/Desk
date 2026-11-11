# plugins/pack-github

`desk.pack-github`, the first built-in pack (ADR 0108): a `pack` plugin, data only, that sets up a
builder's GitHub in one go. Say "Set up GitHub" (or "깃허브 연결해줘") to Eris and the card shows what it
brings; Apply turns it on.

| It brings or does | What |
| --- | --- |
| `pack.plugins` | `desk.github`, the http connector for your issues and pull requests (ADR 0106), a built-in sibling |
| `desk.pack-github.board` | A kanban of your open GitHub work, one column per repository: `desk.universal.open` with an inline universal view over the `desk.github` items (ADR 0087) |
| `desk.pack-github.timeline` | The same work on a timeline, from when it was opened to its last update |
| `pack.opens` | The board: at once when `desk.github` has an account, else from the card once the token is in |
| `pack.profile`, `contributes.profiles` | `builder-morning`, "Builder morning": GitHub, Today, Projects and Universal View on, offered from 7 to 10; it places no window (the board is an overlay) |

While `desk.github` has no account, Apply puts Settings, Connections on it in front, where the token
goes, and the card offers "Open GitHub board" for after. Undo on the card switches back to the profile
in force before and turns off what Apply turned on. Removing the pack leaves `desk.github`: it is not
nested in the pack, only named. "Set up a service…" asks which service first.

```bash
pnpm exec vitest run plugins/pack-github
cargo run -p desk-cli -- plugin validate plugins/pack-github
```
