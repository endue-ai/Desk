> この文書は[英語版](../../architecture.md)の翻訳です。内容に相違がある場合は英語版が優先されます。

# endue Desk のアーキテクチャ

これは設計を英語でまとめた要約です。正本は `docs/ko/desk-structure.md` で、元に戻しにくい決定は `docs/adr/` にあります。

Desk はひとつのアプリとして作られたひとつの OS です。Tauri シェルと小さな Rust コアが Web ランタイムを載せ、そのランタイムの上にあるすべての機能はプラグインです。Emacs と同じように、コアはプリミティブだけを持ち、それ以外はすべてアプリの実行中に変更できます。

## 全体像

```text
 off the device ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ┆  endue AI (cloud brain: agentic loop · models · credits)      changed on the server ┆
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ specs/brain ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 the user's computer               │                           cost of change
 ┌─────────────────────────────────┴──────────────────────────────┐
 │ Plugins      UI (iframe) · logic (Wasm) · tools (MCP, in a VM) │  instant
 │              · connectors (Wasm · MCP) · views (data)          │
 ├────────────────────────────────────────────────────────────────┤
 │ Web runtime  compositor (3D/2D) · surfaces · input · layout    │  restart
 │              · UI plugin host · desk shell (until ADR 0026)    │
 ├────────────────────────────────────────────────────────────────┤
 │ Desk bridge  specs/bridge · specs/item · specs/view            │  rebuild
 │              · specs/connector → TS client · Rust types        │
 ├────────────────────────────────────────────────────────────────┤
 │ Rust core    permissions · event bus · storage · item index    │  rebuild
 │              · logic plugin and connector host (Wasm) · VM     │
 │              · built-in connectors · brain clients             │
 ├────────────────────────────────────────────────────────────────┤
 │ Tauri shell  windows · webviews · primitives (fs, proc, net,   │  rebuild
 │              audio)                                            │
 ├────────────────────────────────────────────────────────────────┤
 │ OS           macOS · Windows · Linux (signing, notarisation,   │  —
 │              OS permissions)                                   │
 └────────────────────────────────────────────────────────────────┘
```

上位のレイヤーはアプリの実行中に変更でき、下位のレイヤーはアプリのアップデートが必要です。デバイスの外にあるのは endue AI だけで、それ以外はすべてユーザーのコンピューター上で動作します。

| レイヤー | フォルダー |
| --- | --- |
| endue AI（クラウド） | リポジトリの外。このリポジトリにあるのは `specs/brain` と `crates/desk-brain-endue` だけです |
| プラグイン | `plugins/` · `packages/plugin-sdk` · `specs/plugin` · `specs/wit` · `examples/` |
| Web ランタイム | `packages/runtime`：コンポジター、UI プラグインのホスト（ADR 0012）、そして ADR 0026 が決まるまではデスクシェル（ADR 0025） · `packages/ui` |
| Desk ブリッジ | `specs/bridge` · 統合レイヤーの契約である `specs/item`、`specs/view`、`specs/connector`（ADR 0032） · `packages/bridge` · `crates/desk-bridge`（これらと `specs/plugin` から生成した型） |
| Rust コア | `crates/desk-core`（統合レイヤーの `data.*`、`connector.*`、`view.*`、`catalog.get` も提供し、OS のカレンダーの上に組み込みコネクター `desk.calendar` と `desk.reminders` を定義、ADR 0036、提案中） · `crates/desk-index`（ひとつの SQLite ファイルに置くアイテムのインデックス、ADR 0033） · `crates/desk-plugin-host`（ロジックプラグインと Wasm コネクターを Wasmtime で実行、ADR 0019、ADR 0034 は提案中） · `crates/desk-vm` · `crates/desk-brain*` |
| Tauri シェル | `apps/desk/src-tauri` · `crates/desk-sys` |
| OS | `apps/desk/src-tauri/capabilities` · リリースワークフロー（署名、公証） |

## Emacs のように、OS のように

Emacs は小さな C コアの上でほぼすべてを Elisp で動かしており、実行中に変更できます。Desk も同じ形をとり、各部分をオペレーティングシステムと同じように名付けています。

| 役割 | オペレーティングシステム | Emacs | Desk |
| --- | --- | --- | --- |
| カーネル | カーネル | C コア | Rust コア |
| システムコール | syscall | Lisp プリミティブ | Desk ブリッジ API |
| ドライバー | デバイスドライバー | OS とのグルーコード | Tauri シェル + Rust クレート |
| ウィンドウマネージャー | ウィンドウマネージャー | フレーム · ウィンドウ | 3D キャンバスのコンポジター |
| シェル | ターミナルのシェル | M-x | Eris · コマンドパレット |
| アプリ | アプリケーション | パッケージ（Elisp） | プラグイン（UI · Wasm · MCP） |
| 接続したデータ | マウントしたファイルシステム · 検索インデックス | Gnus のバックエンド · Org agenda | コネクター · ひとつのインデックスに集まるアイテム · ビュー（ADR 0032） |
| ブート設定 | init | init.el | `init.yaml`（プロファイル + プラグイン + 設定） |
| パッケージマネージャー | apt · brew | package.el · MELPA | マーケットプレイス |
| 振る舞いのオーバーライド | なし | advice · フック | イベントフック · コマンドのオーバーライド |
| アカウント | ユーザーアカウント | なし | endue ID |

ここから 6 つの原則が導かれます。

1. **小さなコア。** Rust コアが持つのは機能ではなく、プリミティブ（fs、proc、net、audio、ui）です。
2. **組み込み機能もプラグイン。** Eris、サイドバー、ツールバー、プロファイル切り替えは、コミュニティのプラグインと同じ API を使います。そのため API に抜けがなく、組み込み機能でさえ置き換えられます。デスクの既定ポリシー（画面の置き場所、キー、ファイル、テーマ、通知）も、データだけの `desk.*` プラグインです（ADR 0017）。ただしデスクシェル（`mountDesk`）はまだプラグインではありません。シェルは `packages/runtime` の中のコードで（ADR 0025）、どこに置くかはまだ提案中の ADR 0026 が決めます。それまで Eris は `plugins/eris` とシェルの中に一つずつあり（ADR 0027）、デスクの端も、ドック・ツールバー・サイドバーのプラグインと、シェルの下端・レール・エージェントバーの二通りがあります（ADR 0028）。
3. **すべてはコマンド。** クリック、音声、ショートカット、エージェントは同じコマンドを呼び出します。人ができることは、Eris やエージェントにもできます。
4. **実行中に変更する。** プラグインを保存するとリロードされます。プラグインの状態はコアのストレージにあり、入れ替えても失われません。
5. **何にでもフックできる。** どのコマンドにも前後にフックを付けられ、Emacs の advice のように丸ごと置き換えることもできます。
6. **見る前に尋ねる。** 人からでもエージェントからでも、すべてのプリミティブ呼び出しはブリッジの権限チェックを通ります。

## 何が、どれだけ速く変わるか

```text
 ┌─ rebuild ──────────────────────────────────────────────────────┐
 │  Rust core · Tauri shell · bridge types   restart after update │
 │  ┌─ restart ────────────────────────────────────────────────┐  │
 │  │  web runtime                         window reload, ~2 s │  │
 │  │  ┌─ instant ──────────────────────────────────────────┐  │  │
 │  │  │  one plugin (iframe · Wasm · MCP)           < 1 s  │  │  │
 │  │  └────────────────────────────────────────────────────┘  │  │
 │  └──────────────────────────────────────────────────────────┘  │
 └────────────────────────────────────────────────────────────────┘
```

内側に行くほど、変更のコストは小さくなります。ユーザーにとってリビルドは、自動アップデート後の 1 回の再起動です。開発者にとっては、さらにコンパイル、署名、公証も伴います。

| 範囲 | リロードされるもの | 目標 | 継続するもの |
| --- | --- | --- | --- |
| 即時 | 変更されたプラグイン（iframe、Wasm インスタンス、または MCP プロセス） | 1 秒未満 | 他のサーフェス、実行中の作業、音声の待機 |
| 再起動 | Web ランタイム（ウィンドウのリロード） | 約 2 秒 | Rust コア、MCP ツール、実行中の CLI |
| リビルド | アプリ全体（自動アップデート後の再起動） | ダウンロード時間 + 数秒 | 保存された状態、プロファイル、インストール済みのプラグイン |

開発でも同じ 3 段階を使います。プラグインのフォルダーは保存時にリロードされ、Web ランタイムは Vite HMR を使い、Rust コアは `cargo watch` でリビルドされます。

## 契約

`specs/` は、オープンな部分とクローズドな部分の境界を定めます。ブリッジ、ブレイン、プラグインの型はここから Rust と TypeScript に生成され、双方が同じテストベクターに対してテストします。`specs/README.md` を参照してください。
