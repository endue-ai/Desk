> この文書は[英語版](../../../README.md)の翻訳です。内容に相違がある場合は英語版が優先されます。

# endue Desk

ひとつの OS である、ひとつのアプリ。

**固定された画面はありません。** Desk は Tauri シェルと小さな Rust コアの上に Web ランタイムを載せたもので、その上にあるすべての機能は、組み込みのものも含めて、アプリの実行中に置き換えられるプラグインです。Emacs と同じように、コアはプリミティブ（ファイル、プロセス、ネットワーク、オーディオ、ウィンドウ）だけを持ち、それ以外はすべて再起動せずに変更できるコードです。

> ステータス：プレアルファ。`just dev` を実行すると、Eris と初回起動のあるデスクが開きます。先に `just brain-echo` を起動しておくと、入力した言葉に Eris が答えます（今はエコーです）。

<!-- スクリーンショット：初回起動シーンとともに追加します。 -->

## ビルド

```bash
pnpm install
just check && just test
just dev
```

Rust（バージョンは `rust-toolchain.toml` で固定されています）、Node 22 以上、pnpm、`just`、およびお使いの OS 向けの Tauri の前提条件が必要です。ランタイムのテストのために、`pnpm --filter @endue-ai/runtime exec playwright install webkit` を一度実行してください。

## プライバシー

Desk にテレメトリはありません。クラッシュレポートは、導入された後もオプトイン方式で、デフォルトでは無効です。

## 詳しく知る

- `docs/architecture.md`：各レイヤーがどのように組み合わさっているか
- `docs/adr/`：元に戻しにくい決定とその理由
- `AGENTS.md`：リポジトリの地図、コマンド、ルール（人と AI エージェントの両方向け）
- `CONTRIBUTING.md`：変更を送る方法

## ライセンス

コードは [Apache-2.0](../../../LICENSE) でライセンスされています。`brand/` にある endue と Eris の名称、ロゴ、イラストは対象外です。[brand/LICENSE](../../../brand/LICENSE) と [TRADEMARK.md](TRADEMARK.md) を参照してください。
