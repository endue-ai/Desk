> 本文为中文译文，内容以[英文原版](../../../CONTRIBUTING.md)为准。

# 为 endue Desk 做贡献

感谢你的帮助。请先阅读 `AGENTS.md`：其中有仓库地图、命令，以及人和 AI 智能体共同遵守的规则。

## 开始之前

- 凡是比修正错别字更大的改动，请先提交 issue，以便在编写代码之前就范围达成一致。
- 问题请发到 GitHub Discussions；安全报告请按照 `SECURITY.md` 提交。

## 命令

所有工作都通过 `just` 进行，CI 使用的也是同一个入口：

```bash
just dev       # run the desktop app
just test      # unit tests (Rust and TypeScript)
just check     # formatting, lints and types
just codegen   # regenerate types from specs/
```

每次推送前请运行 `just check && just test`。

## 提交

- [Conventional Commits](https://www.conventionalcommits.org/)：`feat:`、`fix:`、`docs:`、`test:`、
  `refactor:`、`build:`、`ci:`、`chore:`，可附带作用域，例如 `feat(runtime):`。发布说明和版本号都根据这些
  提交信息生成。
- [Developer Certificate of Origin](https://developercertificate.org/)：每个提交都要用 `git commit -s` 签署。
  签署即证明该改动由你编写，或你有权以 Apache-2.0 许可提交它。未签署的提交无法合并。

## 拉取请求

- 每个 PR 只处理一件事。保持足够小，几分钟内就能读完。
- 文件保持在 400 行以内；在超过之前就把文件拆分。
- 填写 PR 模板，包括 As-is → To-be 表格：评审者会先看这张表。
- 规范变更在 PR 中先行：先编辑 `specs/`，运行 `just codegen`，然后再实现。
- 测试与源码放在一起。改变行为的 PR 要新增或修改一个测试，且该测试在没有此改动时会失败。
- PR 以 squash 方式合并，因此 PR 标题会成为提交信息，必须遵循 Conventional Commits。

## 许可证

提交贡献即表示你同意你的贡献以 Apache-2.0 许可发布。`brand/` 中的文件不接受贡献；参见 `TRADEMARK.md`。
