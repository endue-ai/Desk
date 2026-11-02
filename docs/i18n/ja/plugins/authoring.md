> この文書は[英語版](../../../plugins/authoring.md)の翻訳です。内容に相違がある場合は英語版が優先されます。

# Desk プラグインの作り方

Desk プラグインはひとつのフォルダーです。組み込み機能もまったく同じ形式を使っているため、Desk 自身が画面上で行えることは、どれも自作のプラグインで行えます。このページでは UI プラグイン（v0）とテーマを扱います。ロジック（Wasm）プラグインとツール（MCP）プラグインには今後対応します。

## 例から始める

```bash
cp -R examples/plugin-hello-ui ../my-plugin      # then change the id in plugin.json
cargo run -p desk-cli -- plugin validate ../my-plugin
```

開発中のプラグインを Desk 上で確認するには、そのフォルダーを開発用プラグインとして指定して Desk を起動します。

```bash
DESK_DEV_PLUGINS=$PWD/../my-plugin just dev
```

フォルダー内のファイルを保存すると、そのプラグインのサーフェスだけが 1 秒以内にリロードされます。Desk のほかの部分とプラグインの状態は、そのまま保たれます。

## フォルダー

| パス | 必須 | 用途 |
| --- | --- | --- |
| `plugin.json` | はい | マニフェスト。id、version、kind、entry、permissions、surfaces を記述します |
| `ui/index.html` | はい（`entry`） | Desk がサンドボックス化されたフレームに読み込むページ |
| `ui/*.js`、`ui/*.css` | いいえ | プラグインのコードとスタイル。エントリーからの相対パスで読み込まれます |
| `README.md` | 推奨 | プラグインが何をするのか、どの権限をなぜ求めるのか |

マニフェストは `specs/plugin/v0/plugin.schema.json` に従います。

```json
{
  "id": "example.my-plugin",
  "version": "0.1.0",
  "kind": "ui",
  "entry": "ui/index.html",
  "permissions": [{ "permission": "fs:read", "paths": ["~/Documents/**"] }],
  "surfaces": [{ "id": "main", "title": "My plugin", "placement": "center" }]
}
```

id は小文字の逆ドメイン形式です（`example.my-plugin`）。エントリーはフォルダーの中に置きます。

## SDK

SDK は、エントリーページのインポートマップを通してインポートします。Desk は SDK を `/_desk/plugin-sdk.js` で配信しています。

```html
<script type="importmap">
  { "imports": { "@endue-ai/plugin-sdk": "/_desk/plugin-sdk.js" } }
</script>
<script type="module" src="./main.js"></script>
```

```js
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

defineUiPlugin({
  async mount({ pluginId, bridge, state }) {
    const saved = state.get() ?? { count: 0 };   // survives reloads of this surface
    state.set({ count: saved.count + 1 });
    const { grants } = await bridge.call("perm.query", {});
    bridge.onEvent((event) => console.log(event.event));
  },
});
```

`bridge.call(method, params)` でコアを呼び出します。同じティック内に行った呼び出しは、ひとつのメッセージにまとめて送られます。拒否された呼び出しは、`permission_denied` などの `code` を持つ `BridgeCallError` で reject されます。

## 権限

プラグインのフレームは、スクリプトだけを許可したサンドボックスで動作します。Desk のページにはアクセスできず、トップレベルのナビゲーション、フォームやポップアップ、独自のネットワーク接続も使えません。あらゆる機能はブリッジを経由し、`perm.*` を除くすべてのブリッジ呼び出しには、必要な権限スコープ（`params.scope`）が付きます。コアが応答するのは、そのスコープをカバーする権限をユーザーが付与している場合だけです。

1. 要求する可能性のあるものは、すべて `plugin.json` の `permissions` で宣言します。
2. 必要になったその時点で要求します：`bridge.call("perm.request", { permission, reason })`。
3. 各呼び出しでは、対応するスコープをできるだけ狭くして渡します。

語彙（`fs:read`、`fs:write`、`proc:spawn`、`net:fetch`、`audio:capture`、`ui:surface`、`ui:notify`、`plugin:manage`、`brain:converse`、`cmd:invoke`、`cmd:advise`、`settings:read`、`log:read`、`events:subscribe`、`perm:manage`、`data:read`、`connector:manage`、`view:manage`）は `specs/plugin/v0/README.md` にあります。

## コントリビューション

プラグインは `plugin.json` の `contributes` で、コードなしにデスクの既定ポリシーへ追加できます（ADR
0017）。パレットに並びキーで実行されるコマンド、キーバインド、表示ルール、開けるファイル、テーマ、既定値付きの
設定、プロファイルです。コマンド、設定、テーマの ID はプラグインの ID で始めます。

```json
"contributes": {
  "commands": [{ "id": "example.my-plugin.new", "title": "New note" }],
  "keys": [{ "key": "Mod+Shift+N", "command": "example.my-plugin.new" }],
  "display": [{ "match": { "plugin": "example.my-plugin" }, "area": "right", "size": { "pixels": 360 } }],
  "files": [{ "pattern": "*.md", "plugin": "example.my-plugin" }],
  "settings": { "example.my-plugin.folder": { "kind": "string", "default": "~/notes" } }
}
```

自分のコマンドには `ctx.commands.on` で答え、デスクにある任意のコマンドは `ctx.commands.run` で実行します。
どちらもコアのコマンドレジストリ（`cmd.*`）を通ります。自分が提供していないコマンドを実行するには、その ID を
含む `cmd:invoke` 権限が必要です（例: `{ "permission": "cmd:invoke", "ids": ["desk.theme.*"] }`）。

```js
defineUiPlugin({
  mount(ctx) {
    ctx.commands.on("example.my-plugin.new", async () => "note-1");      // the answer
    ctx.commands.on("desk.files.visit", ({ buffer, path }) => { /* fs.read it, show it */ });
    ctx.commands.on("desk.files.save", ({ buffer, path }) => { /* fs.write it */ });
    document.querySelector("button").onclick = () => ctx.commands.run("desk.theme.toggle");
  },
});
```

ファイルを開くプラグインは `desk.files.visit`、`desk.files.save`、`desk.files.revert` に答え、未保存の変更を
`desk.buffers.update { id, modified: true }` で知らせます。テーマはフレームに `--desk-*` の CSS プロパティと
`ctx.theme` として届きます。フレーム内で押したキーの組み合わせは、`preventDefault()` を呼ばない限りデスクの
キーマップに届きます。既定ポリシーとそれぞれが決めることは `plugins/README.md` にあります。

## アイテムとビュー

人が接続したアプリの中身は、ひとつの形のアイテムとしてデスクに届きます（`specs/item/v0`、ADR 0032）。
イベント、タスク、メッセージ、ノートなどが、どのソースからでも同じ形です。`ctx.data` は `data:read`
権限のもとでデスクのインデックスを読み、クエリに必要な最も狭いスコープを渡します。`ctx.views` は
`view:manage` のもとで、その人のビューを読み書きします。

```js
const { items } = await ctx.data.query({
  kinds: ["task"],
  where: [{ field: "due", op: "lt", value: "2026-10-31T00:00:00+09:00" }],
});
const stop = await ctx.data.subscribe({ kinds: ["task"] }, (changes) => redraw(changes));
await ctx.commands.run("desk.views.open", { id: "desk.today" });
```

ビューはコードではなくデータです（`specs/view/v0`）。組み込みの `desk.views` が `@endue-ai/ui` の要素
（`desk-list`、`desk-table`、`desk-agenda`、`desk-stat`、`desk-markdown`、`desk-card`）で描き、テンプレートは
時計を知っています（`{today}`、`{tomorrow}`）。アプリがこれらの要素を配信するようになれば、あなたのページも
インポートマップ（`"@endue-ai/ui": "/_desk/ui.js"`）で同じ要素を読み込めます。現在はランタイムのテスト
サーバーが配信しています。

## テスト

`@endue-ai/plugin-sdk/testing` を使うと、ブラウザーを使わずに、モックのブリッジを相手にプラグインを実行できます。

```ts
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";

const host = createTestHost({ pluginId: "example.my-plugin", handlers: { "perm.query": () => ({ grants: [] }) } });
await defineUiPlugin(myPlugin, host.transport);
await host.settle();
// host.calls, host.state, host.emit(event), host.upsert(item)
```

公開する前に、`desk plugin validate <folder>` が通る必要があります。CI は `plugins/` と `examples/` 内のすべてのフォルダーに対してこれを実行します。

## テーマを作る

テーマは kind が `theme` のプラグインです。デザインシステムの値と、その値が指すフォント・画像ファイルだけを持ち、コードを持たないため、権限を要求しません（ADR 0056、ADR 0057）。テンプレートか例から始めます。

```bash
pnpm --filter @endue-ai/create-plugin build                       # once
node packages/create-plugin/dist/create-plugin.js ../my-theme --kind theme
DESK_DEV_PLUGINS=$PWD/../my-theme just dev
cargo run -p desk-cli -- theme apply local.my-theme
```

パッケージが公開されれば、これは `pnpm create @endue-ai/plugin my-theme --kind theme` になります。テンプレートには両方の scheme のすべての役割色、既定値のままのほかのレイヤー、それぞれが何を塗るかを説明する README が入っています。`examples/plugin-hello-theme` は、フォントとバックドロップをひとつずつ持つ最小のテーマです。テーマはインストールしても適用されません。適用中のテーマは設定 `desk.theme.active` が指し、テーマスタジオ（右上のパレットボタン、またはコマンドパレットの Themes）、`desk.theme.use`、`desk theme apply` で選びます。

スタジオでもテーマを作れます。「Tune a copy」（または `desk.theme.edit`）は選んだテーマのコピーで、「New theme」は endue のテーマでエディターを開きます。フォントやバックドロップの画像も含め、すべてのレイヤーに操作部品があり、デスク全体が変わっていく下書きをそのまま映し、ゲートの補正はパレットの下に並び、Save で自分のテーマ（`local.<名前>`）として保存します。テーマをリポジトリに置き、テストし、公開するにはフォルダーを使います。

### theme ブロック

`plugin.json` は kind `theme` と `theme` ブロック（`specs/plugin/v0/theme.schema.json`）を持ち、`entry`、`permissions`、`surfaces`、`contributes`、`autoload` は持ちません。

```json
{
  "id": "example.dusk",
  "name": "Dusk",
  "version": "0.1.0",
  "kind": "theme",
  "theme": {
    "license": "Apache-2.0 AND OFL-1.1",
    "type": {
      "sans": "\"Space Grotesk\", system-ui, sans-serif",
      "fonts": [{ "family": "Space Grotesk", "src": "fonts/space-grotesk.woff2", "weight": "300 700" }]
    },
    "shape": { "radius": "round" },
    "dark": {
      "colors": { "background": "#1a1412", "text": "#f6ede6", "primary": "#ff9a62", "primaryForeground": "#2a1206" },
      "backdrop": { "gradient": ["#2e1c15", "#1a1412"], "glow": "rgba(255, 140, 80, 0.12)" }
    }
  }
}
```

`author`、`license`（テーマとそのファイルの SPDX ライセンス式）、`tags`、`preview`（ギャラリーのカードに使う最大 5 色）、`origin`（テーマを言い表した文と、出発点のテーマ）がテーマを説明します。`light` と `dark` はそれぞれひとつの scheme を持ちます。テーマにはどちらかが必要で、ないほうはデスク自身のテーマが代わりを務めます。

### レイヤーとプリセット

レイヤーは 6 つあり、どれにも既定値があるので、パレットだけでもテーマになります。

| レイヤー | キー | 値 |
| --- | --- | --- |
| パレット | `<scheme>.colors` | トークン名（camelCase）から CSS の色へ：`docs/design-system.md` の役割、シェルと Eris のトークン。省いた役割はデスクの値のまま |
| マテリアル | `<scheme>.material` | `opacity` 0.6–1、`blur` 0–24 px、`noise` 0–0.15、`border` 0–2 px、`shadow` none・soft・strong |
| タイポグラフィ | `type` | `sans` と `mono` のフォントスタック、`scale` 0.85–1.25、`tracking` −0.02–0.05 em、`fonts` |
| 形 | `shape` | `radius` none・subtle・soft・round、`density` compact・comfortable・spacious |
| モーション | `motion` | `personality` snappy・smooth・calm |
| バックドロップ | `<scheme>.backdrop` | `color`、`angle` の向きに描く 2–4 色の `gradient`、または `fit` が cover か tile の `image`。それに `glow` |

`<scheme>.terminal.ansi` はターミナルの 16 色を、`<scheme>.contrast` はハイコントラストでのパレットの変更を決めます。角丸、密度、モーション、文字サイズの倍率、影はプリセットです。ランタイムが名前をトークンに変えるので（`docs/design-system.md` の「Choosing a theme」）、デスクがプリセットを調整し直してもテーマはそのまま動きます。数値には範囲があり、値に `url()` は入らないので、有効なテーマは常に使える状態に保たれます。

### ゲート

デスクは適用するすべてのテーマをゲート（`@endue-ai/ui/theme`）に通します。文字は地に対して 4.5:1、枠線と塗りは 3:1、ハイコントラストでは 7:1 と 4.5:1 に達する必要があります。足りない前景色は OKLCH の明度だけを、比率に届く分だけ動かし、地の色は変えません。`contrast` パレットがなければ、テーマのハイコントラストも同じ方法で自身の色から導かれます。ゲートが直すものがないよう、両方の scheme で色の組を確かめてください。

### アセットと上限

フォントは `.woff2`、画像は `.png`、`.jpg`、`.webp` のファイルで（スクリプトを含みうる SVG は使えません）、フォルダーの中に置き、1 ファイル 2 MiB、合計 8 MiB までです。フォントのライセンスは `license` に書き、ライセンスファイルをそばに置きます。組み込みテーマは `fonts/OFL.txt` と、配布元とチェックサムを記した `fonts/SOURCE.md` を置いています。デスクはテーマのフォントをシェルとすべてのプラグインフレームに `FontFace` として読み込み、バックドロップはシェルだけが描きます。

### テーマのテスト

```bash
cargo run -p desk-cli -- plugin validate ../my-theme
pnpm exec vitest run --root ../my-theme
```

`desk plugin validate` はブロックをスキーマと、ファイルを上限と照らし合わせます。テンプレートの `tests/theme.test.ts` は、デスクがテーマを適用する前と同じく、両方の scheme を `compileTheme` でコンパイルして endue のパレットの上で `gate` にかけ、ゲートが直すものがあればそのすべてを示して失敗します。

### `.desk-theme` で共有する

```bash
cargo run -p desk-cli -- theme export local.my-theme     # local.my-theme.desk-theme in Downloads
cargo run -p desk-cli -- theme import ~/Downloads/dusk.desk-theme
```

`.desk-theme` はひとつの JSON ファイルです。`format` は `desk-theme/1`、`manifest` はテーマの `plugin.json`、`files` はブロックが指すファイルの base64 で、16 MiB までです（ADR 0058）。読み込むとテーマプラグインとして検査され、利用者のテーマフォルダーに `local.` 以下の id でインストールされます。`desk theme list` で一覧でき、`desk theme remove` で削除できます。スタジオの Export と Import も同じことを行い、スタジオにドロップした `.desk-theme` も受け付けます。

### マーケット

テーマのマーケットを準備中です（`docs/ko/theme-requirements.md` の TC-05、TS-08）。`.desk-theme` ファイルとその sha256 を載せたインデックスで、スタジオがそれを一覧し、プレビューし、`market.` 以下の id でインストールします。`theme.import` はすでに `https` の URL とバンドルの `sha256` を受け取り、バイト列が一致しなければ拒否します。マーケットが開くまでは、ファイルそのものを共有してください。
