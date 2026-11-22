> この文書は[英語版](../../../README.md)の翻訳です。内容に相違がある場合は英語版が優先されます。

# endue

ひとつの OS である、ひとつのアプリ。

**固定された画面はありません。** endue は Chromium の上の Rust シェルと小さな Rust コアの上に Web ランタイムを載せたもので、その上にあるすべての機能は、組み込みのものも含めて、アプリの実行中に置き換えられるプラグインです。Emacs と同じように、コアはプリミティブ（ファイル、プロセス、ネットワーク、オーディオ、ウィンドウ）だけを持ち、それ以外はすべて再起動せずに変更できるコードです。

> ステータス：プレアルファ。`just dev` を実行すると、Eris と初回起動のあるデスクが開きます。先に `just brain-echo` を起動しておくと、入力した言葉に Eris が答えます（今はエコーです）。

<!-- スクリーンショット：初回起動シーンとともに追加します。 -->

## endue アプリのインストールと更新

endue は、これまで Desk と呼ばれていた GUI アプリです。[v0.3.0 の配布ページ](https://github.com/endue-ai/endue/releases/tag/v0.3.0)には Apple シリコン用（`aarch64`）と Intel 用（`x86_64`）の macOS ディスクイメージがあります。お使いの Mac に合うイメージの SHA-256 をリリースの `SHA256SUMS-macos` と照合し、イメージを開いて endue Desk を「アプリケーション」にコピーしてください。v0.3.0 は Apple の公証を受けていません。照合後も初回の起動がブロックされたら、「システム設定」→「プライバシーとセキュリティ」で endue Desk の「このまま開く」を選んでください。

**endue app** の名前で最初のデスクトップ版が公開されたら、[GitHub Releases](https://github.com/endue-ai/endue/releases) で OS とプロセッサーに合うインストーラーを選び、次の手順に従ってください。

- macOS では Desk を終了し、新しい `.dmg` を開いて `Install endue.command` を実行します。インストーラーは「アプリケーション」内の既存のアプリをバンドル ID で識別するので、名前を変更していても同じ場所に更新されます。複数のコピーがある場合や別の endue アプリがある場合は、マウントしたイメージでターミナルを開き、`"./Install endue.command" --to "/Applications/Studio.app"` のパスを既存の Desk または空いている場所に変更して実行します。
- Windows と Linux では、リリースに含まれている場合、以前と同じ形式のパッケージを使います。Windows のインストール先と Debian のパッケージ名 `endue-desk` は引き継がれます。
- アプリを開くと、`~/.desk` のプロファイルと `plugins.lock`、設定、許可、認証情報への参照を引き続き使えます。v0.3.0 などインストーラーのみの Desk からは、新しいインストーラーで手動更新してください。

公式コマンドは `endue` です。ソースからは `cargo run -p desk-cli -- --help` で試せます。v0.3.0 のディスクイメージには CLI は含まれていません。現在のメジャーバージョンでは既存のスクリプトで `desk` を引き続き使えます。

### Linux x86_64 サーバー

リリースに **endue CLI for Linux x86_64** が掲載されたら、アーカイブ、署名、`SHA256SUMS-cli` を空のディレクトリにダウンロードします。`sha256sum -c SHA256SUMS-cli` で確認し、`tar -xzf endue-cli_*_linux-x86_64.tar.gz` で展開します。`ENDUE_BRAIN_URL` に利用する brain v0 サービスの URL を設定して、`./endue-cli_*/bin/endue run "hello"` を実行します。v0.3.0 で公開されているのは macOS アプリのみです。 [配布元の署名を確認する](../../releasing.md#verify-a-linux-cli-download)

## なぜ endue か

ビルダーのガレージを思い浮かべてください。ビルダーが中央で働き、秘書が覚えて尋ね、ロボットアームが手となり、
どの壁もビルダーの望む形で作業を映す一つの部屋。endue はあなたのコンピュータの中にあるそのガレージです。

- **毎日使う道具。** ビルダーが毎日開くアプリなので、何よりも先にインストールでき、起動し、答えます。
- **エージェントネイティブ。** 常駐秘書の Eris がこのコンピュータに自分の記憶を持ち、ローカルと外部の
  エージェントを調整します。エージェントには手があり、決めるのは人です。
- **ビューが先。** データを一度整えれば、どんな形にも描けます。自分で作るか、Eris に一文で頼むか、
  マーケットから入れます。
- **あなたのもの。** デザインシステム、配置、連携はビルダーが選び、差し替えます。

endue はビルダーの助け手です。安定して物を作れる環境を整え、その中で自由に組ませ、変わらない最高の品質で最高の
製品を作れるよう支えます。endue が今どこにいて、どこへ向かうかは `docs/roadmap.md` にあります。

### デスクはフォルダー

あなたが形づくるものはすべて `~/.desk` にあります。`init.yaml`、プロファイル、`keys.yaml`、ビューと
`plugins.lock` は、読んで編集し git で管理できるただのファイルです。`endue export <フォルダー|file.zip>` で
別のコンピューターへ運び (`--with-data` でデスク自身の状態も。秘密情報は含めません)、`endue import` で
`init.yaml` を上書きせずに戻し、`endue doctor` で各ファイルが仕様どおり読めるかを一覧できます。

## ビルド

```bash
pnpm install
just check && just test
just dev
```

Rust（バージョンは `rust-toolchain.toml` で固定されています）、Node 22 以上、pnpm、`just`、そしてアプリの Chromium（CEF）のための cmake と ninja が必要です。CEF は最初のビルドでダウンロードされます。Linux ではさらに GTK 3、xdo、AppIndicator、ALSA のヘッダーも必要です。ランタイムのテストはアプリと同じバージョンのヘッドレス Chromium で動き、`just test-e2e` が最初に一度だけ `~/.cache/desk` に取得します。テストは Playwright を直接使わず、`just test-e2e` で実行します。

## プライバシー

endue にテレメトリはありません。クラッシュレポートは、導入された後もオプトイン方式で、デフォルトでは無効です。

## 詳しく知る

- `docs/architecture.md`：各レイヤーがどのように組み合わさっているか
- `docs/adr/`：元に戻しにくい決定とその理由
- `docs/roadmap.md`: endue がなぜあり、今どこにいて、どこへ向かうか
- `AGENTS.md`：リポジトリの地図、コマンド、ルール（人と AI エージェントの両方向け）
- `CONTRIBUTING.md`：変更を送る方法

## ライセンス

コードは [Apache-2.0](../../../LICENSE) でライセンスされています。`brand/` にある endue と Eris の名称、ロゴ、イラストは対象外です。[brand/LICENSE](../../../brand/LICENSE) と [TRADEMARK.md](TRADEMARK.md) を参照してください。
