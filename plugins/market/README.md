# plugins/market

`desk.market`, a `policy` plugin: data only. It declares the setting the market for every kind reads
(ADR 0107, `specs/market/v0`); the core runs `market.list`, `plugin.install` and `plugin.remove`, and the
runtime draws them in Settings, Market (`desk.market.open`). Install always asks first, with what the entry
would be allowed (or that it asks for nothing) and, when not verified, the market it comes from; Remove
asks too.

| Setting | Default | What it says |
| --- | --- | --- |
| `desk.market.indexes` | this repository's `market/views/index.json` | The market indexes, by https URL, in order; the first that lists an id wins |

The theme and design system markets stay `desk.theme.markets` and `desk.design.markets`; Settings,
Market lists their entries too. Code (`kind: plugin`) installs only from the endue index
(`https://raw.githubusercontent.com/endue-ai/Desk/main/market/`); anything else is shown as not verified.

```bash
cargo run -p desk-cli -- plugin validate plugins/market
desk market list
desk market install market.week-ahead
```
