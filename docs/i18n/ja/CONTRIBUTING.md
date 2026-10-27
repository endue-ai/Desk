> この文書は[英語版](../../../CONTRIBUTING.md)の翻訳です。内容に相違がある場合は英語版が優先されます。

# endue Desk へのコントリビュート

ご協力ありがとうございます。まずは `AGENTS.md` を読んでください。人と AI エージェントが共有するリポジトリの地図、コマンド、ルールがまとめられています。

## 始める前に

- タイポの修正より大きな変更は、コードを書く前にスコープを合意できるよう、まず issue を作成してください。
- 質問は GitHub Discussions へお寄せください。セキュリティに関する報告は `SECURITY.md` の手順に従ってください。

## コマンド

すべての作業は、CI と同じ入口である `just` を通して行います。

```bash
just dev       # run the desktop app
just test      # unit tests (Rust and TypeScript)
just check     # formatting, lints and types
just codegen   # regenerate types from specs/
```

プッシュの前には毎回 `just check && just test` を実行してください。

## コミット

- [Conventional Commits](https://www.conventionalcommits.org/)：`feat:`、`fix:`、`docs:`、`test:`、`refactor:`、`build:`、`ci:`、`chore:` を使い、`feat(runtime):` のように任意でスコープを付けます。リリースノートとバージョンはこれらのメッセージから生成されます。
- [Developer Certificate of Origin](https://developercertificate.org/)：すべてのコミットに `git commit -s` で sign-off してください。sign-off は、あなたがその変更を書いたこと、または Apache-2.0 のもとでそれを提出する権利を持つことを証明します。sign-off のないコミットはマージできません。

## プルリクエスト

- 1 つの PR では 1 つの関心事だけを扱います。数分で読める大きさに保ってください。
- ファイルは 400 行未満に保ちます。それを超える前にファイルを分割してください。
- PR テンプレートは As-is → To-be の表も含めて記入してください。レビュアーは最初にこの表を読みます。
- 仕様の変更は PR の最初に行います。`specs/` を編集し、`just codegen` を実行してから実装してください。
- テストはソースの隣に置きます。振る舞いを変える PR は、その変更がなければ失敗するテストを追加または変更します。
- PR はスカッシュマージされるため、PR のタイトルがそのままコミットメッセージになり、Conventional Commits に従う必要があります。

## ライセンス

コントリビュートすることで、あなたの貢献が Apache-2.0 でライセンスされることに同意したものとみなされます。`brand/` 内のファイルはコントリビュートを受け付けていません。`TRADEMARK.md` を参照してください。
