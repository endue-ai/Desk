> 이 문서는 [영문판](../../../CONTRIBUTING.md)을 옮긴 번역본이며, 내용이 다르면 영문판이 우선합니다.

# endue Desk에 기여하기

도와주셔서 감사합니다. 먼저 `AGENTS.md`를 읽어 주십시오. 사람과 AI 에이전트가 함께 따르는 저장소 지도,
명령, 규칙이 들어 있습니다.

## 시작하기 전에

- 오타 수정보다 큰 변경이라면, 코드를 작성하기 전에 범위를 합의할 수 있도록 먼저 이슈를 엽니다.
- 질문은 GitHub Discussions에 올리고, 보안 제보는 `SECURITY.md`를 따릅니다.

## 명령

모든 작업은 CI가 사용하는 것과 같은 진입점인 `just`를 거칩니다.

```bash
just dev       # run the desktop app
just test      # unit tests (Rust and TypeScript)
just check     # formatting, lints and types
just codegen   # regenerate types from specs/
```

푸시하기 전에는 매번 `just check && just test`를 실행합니다.

## 커밋

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`,
  `refactor:`, `build:`, `ci:`, `chore:`를 사용하며, `feat(runtime):`처럼 스코프를 붙일 수 있습니다.
  릴리스 노트와 버전은 이 메시지로부터 생성됩니다.
- [Developer Certificate of Origin](https://developercertificate.org/): 모든 커밋에 `git commit -s`로
  서명(sign-off)합니다. 서명은 직접 작성한 변경이거나 Apache-2.0으로 제출할 권리가 있는 변경임을 증명합니다.
  서명이 없는 커밋은 병합할 수 없습니다.

## 풀 리퀘스트

- PR 하나에는 관심사 하나만 담습니다. 몇 분 안에 읽을 수 있을 만큼 작게 유지합니다.
- 파일은 400줄 미만으로 유지합니다. 그보다 커지기 전에 파일을 나눕니다.
- As-is → To-be 표를 포함해 PR 템플릿을 채웁니다. 리뷰어는 이 표를 가장 먼저 읽습니다.
- 스펙 변경이 PR에서 가장 먼저 옵니다. `specs/`를 수정하고 `just codegen`을 실행한 다음 구현합니다.
- 테스트는 소스 옆에 둡니다. 동작을 바꾸는 PR은 그 변경이 없으면 실패하는 테스트를 추가하거나 수정합니다.
- PR은 squash 병합되므로 PR 제목이 커밋 메시지가 되며, Conventional Commits를 따라야 합니다.

## 라이선스

기여하면 기여물이 Apache-2.0으로 라이선스된다는 데 동의하는 것입니다. `brand/`의 파일은 기여를 받지 않습니다.
자세한 내용은 `TRADEMARK.md`에 있습니다.
