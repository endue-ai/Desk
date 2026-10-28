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
