> この文書は[英語版](../../../plugins/authoring.md)の翻訳です。内容に相違がある場合は英語版が優先されます。

# Desk プラグインの作り方

Desk プラグインはひとつのフォルダーです。組み込み機能もまったく同じ形式を使っているため、Desk 自身が画面上で行えることは、どれも自作のプラグインで行えます。このページでは UI プラグイン（v0）を扱います。ロジック（Wasm）プラグインとツール（MCP）プラグインには今後対応します。

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

## ファイルの編集: 編集ティア

ファイルを開くプラグインは、まず読み、編集は後から加えます（ADR 0045）。編集するようになったら、開くすべての
形式に、読み取りティアと並んで、三つのうちひとつの編集ティアを持たせます（ADR 0071）。

| 編集ティア | 約束すること | 保存するとき |
| --- | --- | --- |
| `lossless` | 変更していないファイルを保存すると同じバイトになり、編集は変えるべきバイトだけを変える | ファイルを上書きする |
| `text` | 内容は残るが、書式（コメント、空白、キーの順序）は残らないことがある | 各ファイルの最初の保存で "Save as copy"（既定）か "Overwrite" かを尋ねる |
| `read-only` | 何も保存しない | `desk.files.save` を断る |

すべての形式のティアを、README（形式ごとの読み取りティアと編集ティアの表）と、最初の編集より前のサーフェスに
示します。サーフェスでは `@endue-ai/ui` の `desk-edit-tier` 要素を使います。ティアを挙げていない形式は
`read-only` で、完全な読み取りティアで開けなかったファイルも同じです。実際より少なく約束するのは構いませんが、
多く約束してはいけません。要素の `label` と `detail` 属性には自分の言葉を入れられます。

```html
<desk-edit-tier tier="lossless" format="CSV"></desk-edit-tier>   <!-- CSV · Lossless editing -->
```

`lossless` はバイトについての約束なので、`@endue-ai/plugin-sdk/testing` の二つのチェックで証明します。
フィクスチャには、その形式の難しいところを含めます: BOM、CRLF と混在した改行、末尾の改行なし、引用符と
エスケープ。

```ts
import { assertMinimalEdit, assertRoundTrip } from "@endue-ai/plugin-sdk/testing";

const model = assertRoundTrip(bytes, parse, serialize); // serialize(parse(bytes)) must be bytes
setCell(model, "B2", "Busan");                           // B2 held "Seoul"
assertMinimalEdit(bytes, serialize(model), { find: "Seoul", bytes: "Busan" });
```

`parse` は `Uint8Array` を受け取り、文字列は UTF-8 として扱われます。スパンは、ファイルのバイト単位の
`{ offset, length }`、またはそのバイト列がただ一度だけ現れる場所を示す `{ find }` です。`bytes` はそのスパンが
何になるべきかを示し、省略するとスパンは何になっても構いません。失敗すると、最初に異なるバイトとその行と列、
前後の 16 進とテキスト、スパンの外の変更を示します。チェックは何も import しないので、素の Node のテストからも
`packages/plugin-sdk/src/testing/round-trip.ts` をパスで import できます。

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
