> この文書は[英語版](../../architecture.md)の翻訳です。内容に相違がある場合は英語版が優先されます。

# endue Desk のアーキテクチャ

これは設計を英語でまとめた要約です。正本は `docs/ko/desk-structure.md` で、元に戻しにくい決定は `docs/adr/` にあります。

Desk はひとつのアプリとして作られたひとつの OS です。Chromium（CEF）の上の Rust シェルと小さな Rust コアが Web ランタイムを載せ、そのランタイムの上にある設定とキーバインド以外の機能はプラグインです。Emacs と同じように、コアはプリミティブだけを持ち、それ以外はすべてアプリの実行中に変更できます。

設定 UI、既定のキーバインド、個人設定の保存はプラグインではなくランタイムのコア機能です。すべてのプラグインを無効にしても利用でき、プラグインは追加のキー割り当てを提供できます。 [ADR 0055](../../adr/0055-core-settings-and-keybindings.md).

シェルと画面は変わりつつあります。Desk は Tauri と OS の Web ビューから Chromium（CEF）の上の Rust シェルへ移り、次はどのウィンドウも自分のプロセスで描画する Desk 独自のコンポジターへ移行します（[ADR 0140](../../adr/0140-a-wgpu-compositor-over-cef-off-screen-surfaces.md)）。ステージ 1 は Tauri シェルを削除して終わり、以下で説明するシェルは CEF のシェルです。ステージはレイヤー表の下の「シェルと画面の行き先」にあります。

## 全体像

```text
 off the device ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ┆  endue AI (cloud brain: agentic loop · models · credits)      changed on the server ┆
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ specs/brain ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 the user's computer               │                           cost of change
 ┌─────────────────────────────────┴──────────────────────────────┐
 │ Plugins      UI (iframe) · logic (Wasm) · tools (MCP, in a VM) │  instant
 │              · connectors (Wasm · MCP · http) · views (data)   │
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
 │ Shell (CEF)  windows · browsers · primitives (fs, proc, net,   │  rebuild
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
| Rust コア | `crates/desk-core`（統合レイヤーの `data.*`、`connector.*`、`view.*`、`catalog.get` も提供し、OS のカレンダーの上に組み込みコネクター `desk.calendar` と `desk.reminders` を定義、ADR 0036、提案中。http コネクターはマニフェストどおりにコア自身が実行し、トークンもコアだけが読む、ADR 0106） · `crates/desk-index`（ひとつの SQLite ファイルに置くアイテムのインデックス、ADR 0033） · `crates/desk-plugin-host`（ロジックプラグインと Wasm コネクターを Wasmtime で実行、ADR 0019、ADR 0034 は提案中） · `crates/desk-vm` · `crates/desk-brain*` |
| シェル（CEF） | `apps/desk/shell`：winit と CEF の上のアプリ `endue-desk`（ADR 0143）、そして `crates/desk-web`：エンジンなしで、その URL スキームが何を返し、各ページがどの呼び出し元かを決める部分 · `crates/desk-sys` · `crates/desk-computer`（macOS でのコンピューター操作：スクリーンショット、アクセシビリティツリー、入力、アプリ）。コアはこれを `computer:see` と `computer:control` のもとで `computer.*` として提供し、エージェントの操作はどれも本人の承認を待ちます（ADR 0120、ADR 0123） |
| OS | `apps/desk/shell/packager`：バンドル、CEF のヘルパーアプリとそのエンタイトルメント（ADR 0145） · リリースワークフロー（署名、公証） |

## シェルと画面の行き先

ステージ 1 までの Desk は、OS の Web ビューをひとつ持つひとつの Tauri ウィンドウで、プラグインのウィンドウはどれもそのひとつのページの中にあるサンドボックス化された iframe でした。シェルとすべてのプラグインがひとつのプロセスとひとつのメインスレッドを共有していたため、ループするプラグインひとつでデスク全体が止まり、Linux では WebGPU が使えませんでした。ADR 0140 はこれを変えます。どのウィンドウも自分のプロセスで描画し、wgpu の上に作った Desk 独自のコンポジターがその結果を配置します。ステージ 1 からは、プラグインのサーフェスはそれぞれ自分の Chromium レンダラーなので、レンダラーが落ちても失われるのはそのウィンドウだけです。ただしステージ 2 で合成されるまで、ウィンドウはまだシェルのページの中のフレームです。

```text
 desk (Rust, one process): winit · compositor (wgpu) · CEF host · core · updater
        │ surface             │ surface             │ surface              │ no surface
 web plugin             web plugin            native plugin          logic plugin
 (CEF renderer)         (WebGPU, 3D)          (its own process)      (Wasm, unchanged)
 each: its own process · its own main thread · its own GPU queue · a crash empties one window
```

| ステージ | 変わること | 状況 |
| --- | --- | --- |
| 0 | Tauri アプリの上で：サーフェスごとに `desk-plugin` スキームの自分のオリジンを持つ。ライブなフレームを持つのは見えているウィンドウと直近にフォーカスした 8 つだけ。重い処理はワーカーへ移る。応答しなくなったフレームは、そのウィンドウでだけ「待つ」か「停止」を示す | 完了 |
| 1 | シェルが winit と CEF の上の Rust バイナリ（`apps/desk/shell`、ADR 0143）になっていまのシェルページを表示し、Tauri はなくなる。プラグインの iframe はそれぞれ自分の Chromium レンダラーになる。アプリ単位の e2e は Chromium のリモートデバッグで動かす（ADR 0144） | 完了（#97）：CEF デスクが Tauri アプリの名前 `endue-desk` のままそれを置き換え、canary がそれをビルドする。Windows と Linux での WebGPU はそれぞれの OS で確かめ（#61）、アップデーターを通してインストールされる最初のベータは次のリリースラインで出る |
| 2 | コンポジター（`crates/desk-compositor`）がデスクを描き、各サーフェスのテクスチャを配置する。サーフェスはひとつのプロトコルで話す（`specs/surface`、ADR 0141）。CEF は各プラグインをオフスクリーンで描画する。ウィンドウマネージャーは `packages/runtime` から Rust へ移る | 進行中 |
| 3 | ネイティブプラグイン：サーフェスプロトコルとブリッジを `desk.sock` 越しに話すプロセス | 予定 |

プラグインのコードはどのステージでも変わりません。マニフェスト、SDK、ブリッジのワイヤーフォーマットはそのままです。プラグインが得るのは、自分のプロセスと自分のオリジン、そしてすべての OS での WebGPU です。ライブなプロセスを持つのは見えているウィンドウと直近にフォーカスした 8 つだけで、残りは状態を保ったままスリープします（ADR 0142）。macOS での概念実証では、30 個のオフスクリーン CEF サーフェスを wgpu で合成し、その中で WebGPU を動かし、レンダラーをひとつ強制終了しても他のサーフェスは描画を続けました。軽いレンダラーは約 40 MiB でした（`spikes/compositor/README.md`）。Windows と Linux はこれからです。

## Emacs のように、OS のように

Emacs は小さな C コアの上でほぼすべてを Elisp で動かしており、実行中に変更できます。Desk も同じ形をとり、各部分をオペレーティングシステムと同じように名付けています。

| 役割 | オペレーティングシステム | Emacs | Desk |
| --- | --- | --- | --- |
| カーネル | カーネル | C コア | Rust コア |
| システムコール | syscall | Lisp プリミティブ | Desk ブリッジ API |
| ドライバー | デバイスドライバー | OS とのグルーコード | シェル（winit、CEF） + Rust クレート |
| ウィンドウマネージャー | ウィンドウマネージャー | フレーム · ウィンドウ | 3D キャンバスのコンポジター |
| シェル | ターミナルのシェル | M-x | Eris · コマンドパレット |
| アプリ | アプリケーション | パッケージ（Elisp） | プラグイン（UI · Wasm · MCP） |
| 接続したデータ | マウントしたファイルシステム · 検索インデックス | Gnus のバックエンド · Org agenda | コネクター · ひとつのインデックスに集まるアイテム · ビュー（ADR 0032） · ひとつの YAML 形式ならどの出所でも描くユニバーサルビュー（ADR 0087） |
| ブート設定 | init | init.el | `init.yaml`（プロファイル + プラグイン + 設定） |
| パッケージマネージャー | apt · brew | package.el · MELPA | マーケットプレイス |
| 振る舞いのオーバーライド | なし | advice · フック | イベントフック · コマンドのオーバーライド |
| アカウント | ユーザーアカウント | なし | endue ID |

ここから 6 つの原則が導かれます。

1. **小さなコア。** Rust コアが持つのは機能ではなく、プリミティブ（fs、proc、net、audio、ui）です。
2. **組み込み機能もプラグイン。** Eris、サイドバー、ツールバー、プロファイル切り替えは、コミュニティのプラグインと同じ API を使います。そのため API に抜けがなく、組み込み機能でさえ置き換えられます。デスクの既定ポリシー（画面の置き場所、ファイル、テーマ、通知）も、データだけの `desk.*` プラグインです（ADR 0017）。ただしデスクシェル（`mountDesk`）はまだプラグインではありません。シェルは `packages/runtime` の中のコードで（ADR 0025）、どこに置くかはまだ提案中の ADR 0026 が決めます。それまで Eris は `plugins/eris` とシェルの中に一つずつあり（ADR 0027）、デスクの端も、ドック・ツールバー・サイドバーのプラグインと、シェルの下端・レール・エージェントバーの二通りがあります（ADR 0028）。
3. **すべてはコマンド。** クリック、音声、ショートカット、エージェントは同じコマンドを呼び出します。人ができることは、Eris やエージェントにもできます。
4. **実行中に変更する。** プラグインを保存するとリロードされます。プラグインの状態はコアのストレージにあり、入れ替えても失われません。
5. **何にでもフックできる。** どのコマンドにも前後にフックを付けられ、Emacs の advice のように丸ごと置き換えることもできます。
6. **見る前に尋ねる。** 人からでもエージェントからでも、すべてのプリミティブ呼び出しはブリッジの権限チェックを通ります。

## 何が、どれだけ速く変わるか

```text
 ┌─ rebuild ──────────────────────────────────────────────────────┐
 │  Rust core · Shell (CEF) · bridge types   restart after update │
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
