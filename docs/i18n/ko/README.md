> 이 문서는 [영문판](../../../README.md)을 옮긴 번역본이며, 내용이 다르면 영문판이 우선합니다.

# endue Desk

하나의 앱이 곧 하나의 OS입니다.

**고정된 화면이 없습니다.** Desk는 Tauri 셸과 작은 Rust 코어 위에 웹 런타임을 얹은 구조이며, 그 위의 모든
기능은 내장 기능까지 포함해 앱이 실행되는 동안 교체할 수 있는 플러그인입니다. Emacs처럼 코어는 프리미티브
(파일, 프로세스, 네트워크, 오디오, 창)만 갖고, 나머지는 모두 재시작 없이 바꿀 수 있는 코드입니다.

> 상태: 프리알파. `just dev`를 실행하면 Eris와 첫 실행이 있는 데스크가 열립니다. 먼저 `just brain-echo`를 띄워 두면 입력한 말에 Eris가 답합니다(지금은 에코).

<!-- 스크린샷: 첫 실행 화면과 함께 추가됩니다. -->

## 빌드

```bash
pnpm install
just check && just test
just dev
```

Rust(버전은 `rust-toolchain.toml`에 고정되어 있습니다), Node 22+, pnpm, `just`, 그리고 사용하는 OS에 맞는
Tauri 사전 요구 사항이 필요합니다. macOS에서는 런타임 테스트가 Linux 컨테이너에서 돌기 때문에 Docker Desktop도
필요합니다. Linux와 Windows에서는 `pnpm --filter @endue-ai/runtime exec playwright install webkit`을 한 번
실행합니다. 테스트는 Playwright를 직접 부르지 말고 `just test-e2e`로 실행합니다.

## 개인정보

Desk에는 텔레메트리가 없습니다. 크래시 리포트는 도입되더라도 옵트인 방식이며 기본적으로 꺼져 있습니다.

## 더 알아보기

- `docs/architecture.md`: 각 계층이 어떻게 맞물리는지
- `docs/adr/`: 되돌리기 어려운 결정과 그 이유
- `AGENTS.md`: 저장소 지도, 명령, 규칙 (사람과 AI 에이전트 모두를 위한 문서)
- `CONTRIBUTING.md`: 변경 사항을 보내는 방법

## 라이선스

코드는 [Apache-2.0](../../../LICENSE) 라이선스를 따릅니다. `brand/`에 있는 endue와 Eris의 이름, 로고,
일러스트레이션은 예외입니다. 자세한 내용은 [brand/LICENSE](../../../brand/LICENSE)와 [TRADEMARK.md](TRADEMARK.md)에 있습니다.
