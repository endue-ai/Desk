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

語彙（`fs:read`、`fs:write`、`proc:spawn`、`net:fetch`、`audio:capture`、`ui:surface`、`ui:notify`、`plugin:manage`）は `specs/plugin/v0/README.md` にあります。

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

## テスト

`@endue-ai/plugin-sdk/testing` を使うと、ブラウザーを使わずに、モックのブリッジを相手にプラグインを実行できます。

```ts
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";

const host = createTestHost({ pluginId: "example.my-plugin", handlers: { "perm.query": () => ({ grants: [] }) } });
await defineUiPlugin(myPlugin, host.transport);
await host.settle();
// host.calls, host.state, host.emit(event)
```

公開する前に、`desk plugin validate <folder>` が通る必要があります。CI は `plugins/` と `examples/` 内のすべてのフォルダーに対してこれを実行します。
