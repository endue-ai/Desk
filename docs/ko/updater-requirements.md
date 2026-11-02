# endue Desk 업데이터 요구사항

2026-11-02 · Team endue

> 설치된 데스크가 다음 판을 *스스로* 찾아 받아 두고, 사람이 고른 순간 그 판으로 바뀌게 하려면 무엇이 있어야
> 하는지를 번호를 붙여 적은 문서입니다. `desk-requirements.md` 의 SYS-09(updater: 채널 · 서명 검증 · 재시작
> 시점 선택 · 롤백)와 OPS-01(3 OS 서명 · 공증 · updater · 설치 스모크)을 펼치고, 배포 원본을 **Cloudflare R2**
> 로 정합니다. 요구사항 한 줄이 Task 이슈 하나의 요구사항 칸이 됩니다. 코드와 어긋나면 이 문서를 고치고,
> 되돌리기 어려운 갈림길은 ADR 로 남깁니다(ADR 0054). *현재* 열은 `main` 의 `fa7a4af`(2026-11-02) 기준이고,
> 업데이터는 아직 한 줄도 없습니다(버전 `0.0.0`, 릴리스 워크플로 없음, 서명 없음). §결정 은 2026-11-02 에
> 정한 네 가지입니다.

좋은 업데이터의 값어치는 셋입니다. 사람은 "다시 시작해 업데이트" 하나만 알면 되고, 데스크는 채널 · 버전 ·
해시 · 경로를 보고 다음 판을 *스스로* 고르며, 설치되는 바이트는 언제나 서명된 바이트입니다. 서버는 없습니다.
R2 에는 정적 파일만 있고, 판단은 전부 기기 안에서 합니다.

## 약속

| # | 약속 | 뜻 | 지키는 요구사항 |
| --- | --- | --- | --- |
| 1 | 받아 두고, 바꾸는 건 사람 | 다음 판이 있으면 *즉시* 내려받아 검증해 둔다. 적용은 사람의 한 동작(`desk.update.apply`)에서만. 일하는 중에 화면이 바뀌는 일은 없다 | UPD-09 · UPD-11 · UPD-14 |
| 2 | 서명 없는 바이트는 설치하지 않는다 | 아티팩트는 minisign 서명 + sha256, 매니페스트와 인덱스도 같은 키로 서명. 적용 직전에 한 번 더 검증한다 | UPD-02 · UPD-08 · UPD-11 |
| 3 | 내려가지 않는다 | 다운그레이드는 없다. 잘못된 판은 채널에서 *내리고*(rollback), 고친 판을 *위로* 낸다(roll-forward) | UPD-06 · UPD-08 |
| 4 | 데스크가 고른다 | 채널 · 현재 버전 · 빌드 해시 · `minFrom`(업데이트 경로) · 롤아웃 비율로 다음 판을 기기에서 결정한다. R2 는 묻지 않는다 | UPD-08 · UPD-10 |
| 5 | 말하지 않고는 안 나간다 | 체크 요청에 식별자가 없다(정적 파일 GET 뿐). `desk.update.check: false` 면 네트워크로 한 번도 안 나간다(약속 7, 오프라인) | NF-01 · NF-02 |
| 6 | 모든 동작은 커맨드 | 팔레트 · 레일 · 트레이 · CLI 가 같은 `update.*` 를 부른다. 에이전트는 상태를 읽고 체크를 부를 수 있지만, 적용은 사람의 몫이다(§결정 4) | UPD-07 · UPD-14 · UPD-15 |

## 빌린 개념

| 관용 | 어디서 | Desk | 요구사항 |
| --- | --- | --- | --- |
| 뒤에서 받아 두고 "Restart to Update" 한 줄 | VS Code | 레일의 attention 행 + 트레이 항목 + `desk.update.apply` | UPD-14 |
| 채널(canary → beta → stable)과 단계적 롤아웃 | Chrome(Omaha) | 채널별 `index.json`, `rollout` 비율, 기기 안의 난수 버킷 | UPD-01 · UPD-08 |
| 정적 appcast + EdDSA 서명 | Sparkle | R2 의 정적 JSON + minisign(Ed25519) | UPD-01 · UPD-02 |
| 메타데이터도 서명, 동결 · 다운그레이드 방어 | TUF | `index.json.sig` · `release.json.sig`, `requireSignedVersion`, 버전 단조 증가 | UPD-02 · UPD-08 |
| 매니페스트 형식 · OS 별 설치 · 서명 검증 | Tauri updater 플러그인 | 그대로 쓴다. 정책(어느 판 · 언제)만 Desk 가 더한다 | UPD-11 · UPD-12 |
| 받아 둔 뒤 `quitAndInstall` | Electron autoUpdater | 받아 두기와 적용을 나눈 상태 기계 | UPD-09 · UPD-11 |

## 아키텍처 매핑

- **배포 원본**: R2 버킷 `endue-desk-releases`, 커스텀 도메인 `https://releases.endue.ai`(가정 1). 정적 파일뿐,
  서버 코드 없음. 쓰는 쪽은 GitHub Actions 의 `signing` · `stable` 환경뿐이고 AI 토큰은 닿지 않는다.
- **공개키와 주소는 빌드 때 들어간다**: 릴리스 워크플로가 저장소 변수 `DESK_UPDATER_PUBKEY` 를 컴파일 시점 환경
  변수로 넘겨 바이너리에 박는다. 키가 없는 빌드(개발 빌드, 포크, `just dev`)는 스스로 업데이트하지 않고 `update.*` 에
  `unsupported` 로 답한다. 주소의 기본값은 `https://releases.endue.ai/desk` 이고, 디버그 빌드만 실행 중에
  `DESK_UPDATE_URL` · `DESK_UPDATER_PUBKEY` 로 바꿀 수 있다(가짜 R2 로 시험할 때).
- **crate `desk-update`**(새 crate, Tauri 를 모른다): 매니페스트 타입과 서명 검증, 정책(다음 판 고르기), 스테이징
  저장소(디스크 · sha256 · `staged.json`), 체크 스케줄, 상태 기계. 전부 `crates/desk-update/tests` 로 검증한다.
- **desk-core `core_update.rs`**: 브리지 `update.*` 를 답하고 `update.changed` 를 보낸다. 실제로 받고 설치하는 일은
  `Updater` 트레이트 뒤에 둔다(PKG-01: 코어는 트레이트로만 안다, `with_brain` · `with_calendar` 와 같은 꼴).
- **앱 어댑터 `apps/desk/src-tauri/src/update.rs`**: 받기는 `desk-update` 의 `https`(ureq · rustls), 설치와 재시작은
  `tauri-plugin-updater`. 플러그인의 업데이트 핸들은 받아 둔 판의 `release.json` 으로 만들고, 바이트는 desk-update 가
  검증한 것을 넘긴다. 플러그인은 키가 있는 빌드에만 등록하고, 그 JavaScript 커맨드는 어떤 capability 에도 넣지 않는다.
- **셸**(`apps/desk/src/updates.ts`): 레일 attention 행, 알림 한 번, `desk.update.*` 커맨드. 정책 플러그인은 두지 않는다
  (릴리스 빌드에는 내장 플러그인이 실리지 않고, 커맨드는 늘 있어야 해서 `desk` 소유다). **CLI**: `desk update`.
  **트레이**: "Restart to update".
- **권한**: `update:manage` 하나. 런타임(`desk`)과 `cli` 에만 준다. 플러그인은 `events.subscribe` 로 `update.changed`
  를 들을 수 있을 뿐, 체크도 적용도 못 한다. 런타임의 커맨드 `desk.update.apply` 를 다른 호출자가 `cmd.invoke` 로
  부르면 사람에게 먼저 묻는다(§결정 4).
- **설정**(owner `desk`, ADR 0031 의 계층을 따라 init.yaml `settings:` 로 적는다):

| 키 | 값 | 기본 | 뜻 |
| --- | --- | --- | --- |
| `desk.update.channel` | `stable` · `beta` · `canary` | 정식 판은 `stable`, 프리릴리스 판(`-pre.<run>`)은 `canary` | 어느 채널의 인덱스를 보는가. beta 는 이 키로 고른다 |
| `desk.update.auto` | boolean | `true` | 다음 판을 찾으면 묻지 않고 받아 둔다. `false` 면 `available` 에서 멈추고 사람이 `desk.update.download` 를 부른다 |
| `desk.update.check` | boolean | `true` | `false` 면 체크 자체를 안 한다(네트워크 0). 수동 `update.check` 만 남는다 |

## 흐름

```text
 R2 (정적)                          데스크 (desk-update · core · app)                       사람
 ─────────                          ──────────────────────────────────────                  ────
 channels/<ch>/index.json  ◀──GET── 시작 30 s 뒤, 4 h 마다, update.check 때
 index.json.sig            ◀──GET── 서명 검증 → 후보 고르기(정책) → 없으면 up-to-date
 releases/<v>/release.json ◀──GET── 서명 검증 → 내 target 의 url · signature · sha256
 releases/<v>/<artifact>   ◀──GET── 플러그인이 받으며 minisign 검증 → 디스크에 두고 sha256 비교
                                    staged.json 기록 → update.changed{staged}  ──────────▶  레일 행 · 알림 · 트레이
                                    (기다린다. 다음 체크에서 인덱스에 없으면 버린다)
                                    update.apply  ◀─────────────────────────────────────  "Restart to update"
                                    sha256 + minisign 재검증 → 플러그인 install → 재시작   ◀──  새 판
```

## R2 배치

```text
desk/
├── channels/
│   ├── stable/
│   │   ├── index.json            # 이 채널에 올라 있는 판의 목록, 새 것부터. 정책 필드를 품는다
│   │   ├── index.json.sig        # minisign 서명 (업데이터 키)
│   │   └── latest.json           # Tauri 정적 형식의 최신 판. 사람 · 외부 도구용 (앱은 index 를 본다)
│   ├── beta/      (같은 셋)
│   └── canary/    (같은 셋)
├── releases/<version>/
│   ├── release.json              # 그 판의 매니페스트: Tauri 정적 형식 + desk 확장
│   ├── release.json.sig
│   ├── endue-desk_<v>_darwin-aarch64.app.tar.gz   + .sig   # darwin-aarch64(-app)
│   ├── endue-desk_<v>_darwin-x86_64.app.tar.gz    + .sig   # darwin-x86_64(-app)
│   ├── endue-desk_<v>_windows-x86_64-setup.exe    + .sig   # windows-x86_64(-nsis), 첫 설치도 이것
│   ├── endue-desk_<v>_linux-x86_64.AppImage       + .sig   # linux-x86_64(-appimage)
│   ├── endue-desk_<v>_linux-x86_64.deb            + .sig   # linux-x86_64-deb
│   ├── endue-desk_<v>_linux-x86_64.rpm            + .sig   # linux-x86_64-rpm
│   ├── endue-desk_<v>_darwin-aarch64.dmg · _darwin-x86_64.dmg   # 첫 설치용 (universal 없음)
│   └── SHA256SUMS
└── keys/updater.pub              # 사람이 확인하는 용도. 앱은 공개키를 내장한다
```

- `releases/*` 는 불변: `Cache-Control: public, max-age=31536000, immutable`. `channels/*` 는 `max-age=60`.
  클라이언트는 `If-None-Match` 를 보낸다.
- **올리는 순서가 곧 정합성**이다: 아티팩트 → `release.json`(+sig) → `index.json`(+sig) → `latest.json`. 인덱스에
  오른 판은 그 순간 아티팩트가 이미 있다. 반대 순서는 금지(스크립트가 거부한다).
- 버전은 빌드마다 유일하다(§릴리스 파이프라인). 같은 경로에 다른 바이트를 다시 올리는 일은 없다.
- 파일 이름은 Tauri 가 붙인 이름(공백이 든 `endue Desk_…`)이 아니라 `endue-desk_<v>_<target><확장자>` 다
  (`scripts/release-collect.mjs`). 인덱스는 버킷에서 직접 읽어 고친다(캐시된 공개 주소가 아니라).

## 매니페스트

`release.json` — Tauri updater 의 정적 형식(`version` · `notes` · `pub_date` · `platforms`)에 `desk` 확장을 더한다.
플러그인은 모르는 키를 무시하므로 한 파일로 둘 다 섬긴다.

```json
{
  "version": "0.2.0",
  "notes": "https://github.com/endue-ai/Desk/releases/tag/v0.2.0",
  "pub_date": "2026-11-20T09:12:00Z",
  "platforms": {
    "darwin-aarch64":       { "url": "https://releases.endue.ai/desk/releases/0.2.0/endue-desk_0.2.0_aarch64.app.tar.gz", "signature": "untrusted comment: …" },
    "darwin-x86_64":        { "url": "…/endue-desk_0.2.0_x86_64.app.tar.gz", "signature": "…" },
    "windows-x86_64-nsis":  { "url": "…/endue-desk_0.2.0_x64-setup.exe",     "signature": "…" },
    "linux-x86_64-appimage":{ "url": "…/endue-desk_0.2.0_amd64.AppImage",    "signature": "…" },
    "linux-x86_64-deb":     { "url": "…/endue-desk_0.2.0_amd64.deb",         "signature": "…" },
    "linux-x86_64-rpm":     { "url": "…/endue-desk_0.2.0_x86_64.rpm",        "signature": "…" }
  },
  "desk": {
    "commit": "c46d12b7e1a0…",
    "minFrom": "0.1.0",
    "artifacts": {
      "darwin-aarch64":      { "sha256": "9f86d08…", "size": 143221890 },
      "windows-x86_64-nsis": { "sha256": "2c26b46…", "size": 98111203 }
    }
  }
}
```

`channels/<ch>/index.json` — 채널에 올라 있는 판, 새 것부터. 내리는 것(rollback)은 항목을 지우는 것이다.

```json
{
  "channel": "stable",
  "generated": "2026-11-20T09:15:00Z",
  "releases": [
    { "version": "0.2.0", "commit": "c46d12b", "date": "2026-11-20", "minFrom": "0.1.0", "rollout": 100,
      "targets": ["darwin-aarch64", "darwin-x86_64", "windows-x86_64-nsis", "linux-x86_64-appimage", "linux-x86_64-deb", "linux-x86_64-rpm"],
      "release": "https://releases.endue.ai/desk/releases/0.2.0/release.json" },
    { "version": "0.1.2", "commit": "8a1f0c3", "date": "2026-11-08", "minFrom": "0.1.0", "rollout": 100, "targets": ["…"], "release": "…" },
    { "version": "0.1.0", "commit": "3e9d7b2", "date": "2026-11-03", "minFrom": "0.0.0", "rollout": 100, "targets": ["…"], "release": "…" }
  ]
}
```

| 필드 | 뜻 |
| --- | --- |
| `minFrom` | 이 판으로 *바로* 올 수 있는 가장 낮은 버전. 그보다 낮은 데스크는 `minFrom` 을 만족하는 더 낮은 판(디딤돌)을 먼저 거친다. 데이터 마이그레이션이 순서를 요구할 때 쓴다 |
| `rollout` | 0–100. 이 비율의 기기에만 보인다. 기기 안의 난수 버킷으로 정하고, 바깥으로는 아무것도 보내지 않는다 |
| `targets` | 아티팩트가 있는 target. 내 target 이 없으면 후보가 아니다 |
| `commit` | 빌드한 소스의 git 커밋. 앱도 자기 커밋을 내장하므로(`DESK_BUILD_COMMIT`) 상태 줄과 버그 리포트가 "0.2.0 (c46d12b)" 로 말한다 |
| `notes` | 릴리스 노트는 GitHub 에 있다(§결정 2). stable 은 GitHub Release 페이지, canary · beta 는 그 빌드의 커밋 페이지 |

## 데스크의 판단

입력: 현재 버전(semver, `tauri.conf.json` 의 `version` 이 `package_info` 로 들어온다) · 내 커밋 · 내 target
(`{os}-{arch}` 와 `{os}-{arch}-{installer}`, 플러그인이 정한다: `darwin-aarch64`, `windows-x86_64-nsis`,
`linux-x86_64-deb` …) · 채널 · 기기 난수 salt(설치 때 한 번 만들어 데이터 폴더에 둔다).

1. **후보** = 채널 인덱스의 항목 중 `version > 현재` 이고 `targets` 에 내 target 이 있는 것. 버전 비교는 semver
   (프리릴리스 포함). 같은 버전 다른 커밋은 후보가 아니다 — 버전은 빌드마다 유일하다.
2. **경로**: 후보 중 `minFrom <= 현재` 인 것만 바로 갈 수 있다. 가장 새 후보가 `minFrom > 현재` 면 `minFrom <= 현재`
   인 가장 새 후보가 *이번* 판이고, 적용 뒤 다음 체크에서 이어간다. 그래서 "업데이트 경로"는 서버가 아니라
   데스크가 걷는다.
3. **롤아웃**: `rollout < 100` 이면 `sha256(salt ‖ version)` 의 첫 바이트 `% 100 < rollout` 일 때만 보인다. 같은
   기기는 같은 판에 늘 같은 답을 낸다(롤아웃이 커지면 들어오고, 줄지 않는다).
4. **다운그레이드 없음**: 현재보다 낮거나 같은 버전은 후보가 아니다(`allowDowngrades: false`).
5. **받아 둔 것의 운명**: 받아 둔 판이 인덱스에서 사라졌으면(rollback) 버린다. 더 새 후보가 생겼으면 버리고 새로
   받는다. 그 밖에는 그대로 두고 레일 행만 다시 보인다(재시작 뒤에도).
6. **언제 체크**: `desk_ready` 30 s 뒤, 그 뒤 4 h 마다(± 10 % 지터), 사람이 `update.check` 를 부를 때. 실패는
   다음 주기로 미루고 뒤로 물러난다(1 m · 5 m · 30 m, 이후 4 h). 네트워크가 없으면 조용하다(로그 한 줄).
7. **언제 받기**: 후보가 정해지면 *즉시*(`desk.update.auto`, 기본 켬). 전부 메인 스레드 밖에서.
8. **언제 바꾸기**: 사람이 `update.apply` 를 부를 때만. 종료할 때 몰래 적용하지 않는다(설정으로 여는 것은 3단계).

## 상태 기계

```text
idle ──check──▶ checking ──▶ up-to-date ──(4 h)──▶ idle
                   │                  └──▶ available{version} ──auto/다운로드──▶ downloading{received,total}
                   │                                                                   │
                   ▼                                                                   ▼
                failed{reason} ──backoff──▶ idle                                  staged{version, commit}
                                                                                       │ apply
                                                                                   applying ──▶ (재시작)
```

상태가 바뀔 때마다 `update.changed{state, …}` 가 `update:manage` 를 가진 호출자에게 간다. `update.status` 는 지금
상태와 현재 버전 · 커밋 · 채널 · 마지막 체크 시각 · 받아 둔 판을 답한다. 받아 둔 판의 기록은
`<data>/updates/staged.json` 이고 아티팩트는 `<data>/updates/<version>/<file>` 이다. 디스크에는 한 판만 둔다.

## 검증 (해시와 서명)

| 무엇을 | 언제 | 어떻게 |
| --- | --- | --- |
| `index.json` · `release.json` | 받을 때마다 | 옆의 `.sig` 를 앱에 내장한 공개키로 minisign 검증. 틀리면 그 체크는 실패(로그), 받아 둔 것은 건드리지 않는다 |
| 아티팩트 | 받을 때 | 플러그인이 `download` 끝에 minisign 검증. 이어서 sha256 과 길이를 `release.json` 과 비교하고 디스크에 둔다 |
| 받아 둔 아티팩트 | 적용 직전 | sha256 + minisign 을 **다시** 검증한다. 플러그인의 `install` 은 검증하지 않기 때문이다 |
| 서명의 버전 | 받을 때 | `requireSignedVersion: true`: 서명의 trusted comment 가 품은 버전이 매니페스트의 버전과 같아야 한다(옛 아티팩트에 새 버전 번호를 붙여 내리는 공격 방어) |

키는 하나(`tauri signer generate`, Ed25519). 개인키와 비밀번호는 GitHub `signing` 환경에만 있고, 공개키는
`tauri.conf.json` 의 `plugins.updater.pubkey` 에 내장돼 바이너리에 들어간다. 키 교체는 새 공개키를 내장한 판을
*옛 키로 서명해* 먼저 내고, 그 다음 판부터 새 키로 서명한다(2단계 키 롤오버).

## OS 별 적용

| OS | 첫 설치 | 업데이트 아티팩트 | 적용 | 주의 |
| --- | --- | --- | --- | --- |
| macOS | `.dmg` (aarch64 · x86_64 따로) | `.app.tar.gz` (서명 · 공증된 .app 그대로) | 번들 자리를 rename 으로 교체, 앱 재시작 | `/Applications` 에 쓰기 권한이 없으면 OS 인증 창이 한 번 뜬다 |
| Windows | NSIS `-setup.exe`, 사용자별 설치(`installMode: currentUser`) | 같은 `-setup.exe` | `/UPDATE /P`(passive) 로 설치기가 돌고 앱을 다시 띄운다 | UAC 없음(사용자별 설치라서). MSI 는 업데이터 대상에서 뺀다(같은 버전 재설치 · 다운그레이드 제약) |
| Linux | `.deb` · `.rpm` · `.AppImage` | 설치한 형식 그대로(플러그인이 `bundle_type` 으로 고른다) | AppImage 는 제자리 교체, `.deb` · `.rpm` 은 `pkexec` 로 `dpkg -i` · `rpm -U`(비밀번호 한 번) | 설치 스모크는 `.deb` 이다. AppImage 가 `/tmp` 와 다른 마운트면 실패 → 상태 `failed` 와 이유 |

## 겉으로 보이는 것

- **레일** attention 행: "Desk 0.2.0 is ready" 와 그 아래 "Restart to update" 버튼(`desk.update.apply`). 받는 중엔
  "Downloading Desk 0.2.0 · 43%", auto 가 꺼져 있으면 "Desk 0.2.0 is available" 과 "Download". 행은 받아 둔 판이 있는
  동안 남고, 지우는 길은 없다(스누즈 없음).
- **알림** 한 번(`ui.notified`): `staged` 로 들어갈 때. 재시작 뒤 같은 판에 다시 알리지 않는다.
- **트레이**: `staged` 일 때만 "Restart to update (0.2.0)" 항목(ADR 0053 의 Search · Open · Quit 옆).
- **커맨드**: `desk.update.check` · `desk.update.download` · `desk.update.apply` · `desk.update.notes`(GitHub 의 릴리스
  노트를 `shell.open` 으로). 팔레트 · 키 · 레일 · 트레이가 같은 길로 부른다. `desk.update.apply` 를 다른 호출자(플러그인 ·
  에이전트)가 부르면 사람에게 먼저 묻는다.
- **CLI**: `desk update`(상태) · `desk update check` · `desk update apply`. 소켓 호출자 `cli` 의 `update:manage` 로.
- **설정 UI**: 지금은 init.yaml 세 키뿐. SET 의 생성된 설정 UI 가 생기면 거기 따라온다.

## 릴리스 파이프라인

`desk-structure.md` §GitHub 와 오픈소스 뼈대의 워크플로 계획(canary · promote · release · rollback)을 그대로 두되,
**게시 대상을 GitHub Release 에서 R2 로** 바꾼다. 바이너리는 R2 에만 있고, GitHub Release 는 릴리스 노트의 자리다
(§결정 2). 업데이터는 R2 만 본다. `release` 의 게시 단계는 사람이 승인하는 `stable` 환경에서 돌므로, 그 환경에도
`signing` 과 같은 업데이터 키와 R2 비밀값을 둔다.

| 워크플로 | 트리거 | 하는 일 |
| --- | --- | --- |
| `release-build.yml` | canary · release 가 부름 | 4 target(`darwin-aarch64` · `darwin-x86_64` · `windows-x86_64` · `linux-x86_64`) `tauri build`(`createUpdaterArtifacts`, 서명에 버전, 설정의 `plugins.updater.pubkey` 에 공개키 — 없으면 CLI 가 서명을 거부한다) → macOS codesign + notarize(Apple 비밀값이 있을 때) → 정규 이름으로 모으기. Windows 는 NSIS 만, Authenticode 는 인증서를 정한 뒤 |
| `canary.yml` | main push | 빌드 → R2 `releases/<v>/` 업로드(순서대로) → `channels/canary/index.json` 갱신 · 서명 → 2주 지난 canary 정리(§결정 3). 버전은 `<다음>-pre.<run>`, 노트는 커밋 페이지 |
| `promote.yml` | 주 1회 · 수동 | 3일 넘게 canary 에 있던 가장 새 판을 `channels/beta/index.json` 에 올린다. 재빌드 없음, 포인터만. 새 크래시 조건(ADR 0007)은 크래시 리포트가 생기면 더한다 |
| `release.yml` | 태그 `v*`(사람) | canary 와 같은 빌드를 태그 버전으로 → `channels/stable/index.json` → GitHub Release(자동 생성 노트, 바이너리 없음, R2 링크). `stable` 환경(사람 승인 단계) |
| `rollback.yml` | 수동(사람만) | 한 채널의 인덱스에서 한 판을 내린다(아티팩트는 남긴다). 받아 둔 데스크는 다음 체크에서 버리고, 이미 올라간 데스크는 고친 판(roll-forward)을 기다린다 |

- **버전**: 태그 빌드는 태그 그대로(`v0.2.0` → `0.2.0`), main 빌드는 가장 최근 태그의 다음 패치 +
  `-pre.<run>`(`0.2.1-pre.48`, 태그가 없으면 `0.1.0-pre.<run>`). semver 프리릴리스라 빌드마다 유일하고 태그 빌드보다
  낮다. 워크플로가 빌드 때 `tauri.conf.json` 의 `version` 을 덮어쓰므로 저장소의 `0.0.0` 은 그대로다. 채널은 버전
  문자열이 아니라 *어느 인덱스에 올랐는가* 다. 그래서 같은 아티팩트가 canary → beta 로 올라간다.
- **비밀**: `signing` 환경 — `TAURI_SIGNING_PRIVATE_KEY` · `_PASSWORD`, `APPLE_CERTIFICATE` ·
  `APPLE_CERTIFICATE_PASSWORD` · `APPLE_SIGNING_IDENTITY` · `APPLE_ID` · `APPLE_PASSWORD` · `APPLE_TEAM_ID`, Windows
  서명 인증서, R2 의 `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY`(버킷 하나, 쓰기). 저장소 변수
  `DESK_UPDATER_PUBKEY`(그리고 바꾸고 싶을 때 `R2_BUCKET` · `DESK_RELEASES_URL`). 인덱스 서명도 같은 키. 업데이터
  키 · 공개키 · R2 비밀값 중 하나라도 없으면 canary · promote 는 한 줄 알리고 아무것도 하지 않고, 태그의 release 는
  실패한다. Apple 비밀값이 없으면 macOS 는 서명 · 공증 없이 빌드한다.
- **스크립트**(`node --test` 로 검증): `scripts/release-version.mjs`(빌드 버전), `release-collect.mjs`(번들 → 정규
  이름), `release-manifest.mjs`(`release.json` 생성, 인덱스에 올리기 · 내리기 · 2주 정리 · 승격할 판 고르기),
  `release-publish.mjs`(올리는 순서 강제, `Cache-Control` 지정). 업로드는 S3 호환 API(`aws s3`, R2 엔드포인트)로
  하고, `.sig` 는 `tauri signer sign` 이 만든다.
- **개발 루프**: `just release-serve <dir>` 가 가짜 R2 를 `http://127.0.0.1` 로 띄운다. 디버그 빌드만
  `DESK_UPDATE_URL` 로 거기를 본다(플러그인은 디버그에서만 http 를 허용하고 릴리스 빌드는 무시한다).

## 요구사항

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| UPD-01 | R2 배치와 매니페스트: `channels/<ch>/index.json`(+sig · latest.json) · `releases/<v>/release.json`(+sig) · 아티팩트 · `SHA256SUMS`. 캐시 정책과 올리는 순서는 §R2 배치 | 있음 (#294) | 1 |
| UPD-02 | 빌드와 서명: 4 target updater 아티팩트(`createUpdaterArtifacts`), minisign(서명에 버전), macOS codesign + notarize, Windows Authenticode, NSIS 사용자별 설치. 키는 `signing` 환경 | 있음 (#294) | 1 |
| UPD-03 | canary 게시: main 마다 빌드 → 서명 → R2 → canary 인덱스. 버전 `<다음>-pre.<run>`. 설치 스모크는 e2e 워크플로가 계속 맡는다 | 있음 (#294) | 1 |
| UPD-04 | stable 게시: 사람이 태그 `v*` → 빌드 → stable 인덱스 → GitHub Release(노트). 첫 판 `0.1.0` | 있음 (#294) | 1 |
| UPD-05 | beta 승격: 주 1회 · 수동, 3일 넘게 canary 에 있던 가장 새 판을 beta 인덱스에(포인터만) | 있음 (#294) | 1 |
| UPD-06 | 롤백: 수동 워크플로가 채널 인덱스에서 한 판을 내린다. 데스크는 받아 둔 그 판을 버린다 | 있음 (#294) | 1 |
| UPD-20 | canary 보관 2주: 14일 지난 canary 판을 canary 인덱스에서 내리고, 다른 채널 인덱스가 올리지 않은 판이면 R2 의 `releases/<v>/` 도 지운다 | 있음 (#294) | 1 |
| UPD-07 | 브리지 명세 `update.*`: `update.status` · `update.check` · `update.download` · `update.apply`, 이벤트 `update.changed`, 권한 `update:manage`, 벡터, codegen | 있음 (#274) | 1 |
| UPD-08 | 정책(`desk-update`): 인덱스 · 매니페스트 파싱과 서명 검증, 후보 → `minFrom` 경로 → 롤아웃 → 다운그레이드 금지, 받아 둔 판의 운명(§데스크의 판단 1–5) | 있음 (#292) | 1 |
| UPD-09 | 스테이징: 받은 바이트를 `<data>/updates/<v>/` 에, sha256 · 길이 비교, `staged.json`, 디스크에 한 판, 버리기 | 있음 (#292) | 1 |
| UPD-10 | 스케줄: 시작 30 s · 4 h 지터 · 수동 · 백오프, 전부 메인 스레드 밖. `desk.update.check: false` 면 네트워크 0 | 있음 (#292) | 1 |
| UPD-11 | 적용: 재검증(sha256 + minisign) → 플러그인 `install` → 재시작. OS 별 경로는 §OS 별 적용. 실패는 `failed{reason}` 로 남고 받아 둔 것은 지운다 | 있음 (#297) | 1 |
| UPD-12 | 앱 어댑터: `tauri-plugin-updater` 등록, 컴파일 시점 `DESK_UPDATER_PUBKEY` · `DESK_BUILD_COMMIT` 내장, 채널별 인덱스 주소, 디버그 `DESK_UPDATE_URL`, 트레이 항목 | 있음 (#297) | 1 |
| UPD-13 | 코어: `Updater` 트레이트 · `core_update.rs` · 설정 `desk.update.{channel,auto,check}` · `desk` 와 `cli` 에 `update:manage` · 로그 채널 `desk.update` | 있음 (#303) | 1 |
| UPD-14 | 셸(`apps/desk/src/updates.ts`): 레일 attention 행(받는 중 · 준비됨 · 버튼), 판마다 알림 한 번, 커맨드 넷, 다른 호출자의 `desk.update.apply` 는 사람에게 묻기 | 있음 (#297) | 1 |
| UPD-15 | CLI: `desk update`(상태) · `desk update check` · `desk update apply` | 있음 (#303) | 1 |
| UPD-16 | 업데이트 스모크: 직전 canary `.deb` 설치 → `canary` 채널로 실행 → 상태 줄의 `update: staged` → `desk update apply` → 새 버전 확인. `verify-signature.sh` 를 실제 검사로(minisign `.sig`, `spctl`, `signtool`) | 없음(스텁) | 2 |
| UPD-17 | 문서: `desk-structure.md` §뼈대(R2), `docs/security/threat-model.md` §The updater, `docs/qa/TESTING.md`, `SECURITY.md` 지원 버전 | 있음 (#298 · #297) | 1 |
| UPD-18 | 이어 받기: Range 로 스트리밍 다운로드와 재개, sha256 은 받으면서 | 없음 | 2 |
| UPD-19 | 종료할 때 적용: `desk.update.apply: on-quit` 설정(기본 꺼짐) | 없음 | 3 |
| NF-01 | 체크 요청에 식별자 · 쿠키 · 기기 정보가 없다. URL 의 자리표시자는 `{{current_version}}` · `{{target}}` · `{{arch}}` 뿐 | — | 1 |
| NF-02 | 오프라인 · DNS 실패 · 서명 불일치는 데스크를 멈추지 않는다. 로그 한 줄과 다음 주기 | — | 1 |
| NF-03 | 체크 · 다운로드 · 검증은 메인 스레드와 웹뷰 밖에서. 받는 중 입력 지연 16 ms 예산(RT-16)을 지킨다 | — | 1 |
| NF-04 | 디스크: 받아 둔 판 하나(200 MB 상한), 임시 파일은 적용 · 실패 뒤 지운다 | — | 1 |

## 단계

| 단계 | 끝나면 되는 것 | 요구사항 |
| --- | --- | --- |
| 1 | canary 를 깐 데스크가 다음 canary 를 받아 두고, "Restart to update" 로 올라간다. stable · beta 도 같은 길. 롤백이 되고 canary 는 2주 뒤 정리된다 | UPD-01~15 · 17 · 20, NF |
| 2 | 스모크가 실제 업데이트를 3 OS 에서 돌린다. 이어 받기 | UPD-16 · 18 |
| 3 | 종료할 때 적용, 설정 UI | UPD-19 |

## 이슈 분해 (1단계)

사람이 먼저 할 일(코드 밖): R2 버킷 `endue-desk-releases` 와 도메인 `releases.endue.ai`, 버킷 한정 쓰기 토큰 →
`signing` 환경; `tauri signer generate` 로 업데이터 키 → 개인키 · 비밀번호는 `signing` 환경, 공개키는 저장소 변수
`DESK_UPDATER_PUBKEY`; Apple Developer 인증서 · App-specific password · Team ID; Windows 코드 서명 인증서. 이것들이
없어도 아래 다섯 PR 은 병합되고, 워크플로는 빌드까지만 하고 게시를 건너뛴다.

| # | 이슈 | 요구사항 | 무엇을 |
| --- | --- | --- | --- |
| T1 | #268 `update.*` 계약과 이 문서 · ADR 0054 | UPD-07 | `specs/bridge/v0/update.schema.json`, `update:manage`, `update.changed`, 벡터, codegen, 코어는 `unsupported` |
| T2 | #278 (#292) crate `desk-update` | UPD-08 · 09 · 10 | 인덱스 · 매니페스트 타입, minisign 검증, 정책(후보 · `minFrom` · 롤아웃 · 다운그레이드 금지), 스테이징, 스케줄, 상태 기계. Tauri 를 모른다 |
| T3 | #296 (#303) 코어가 `update.*` 를 섬긴다, CLI `desk update` | UPD-13 · 15 | `core_update.rs`, `desk` · `cli` 에 `update:manage`, 설정 `desk.update.*`, `update.changed` 발행 |
| T4 | #297 앱 어댑터와 셸 | UPD-11 · 12 · 14 | `tauri-plugin-updater` 로 설치 · 재시작, 트레이 항목, 정책 플러그인 `desk.update`, 레일 행 · 알림 · 커맨드 |
| T5 | #294 (#298) 릴리스 파이프라인과 문서 | UPD-01~06 · 17 · 20 | `scripts/release/*.mjs`, `canary` · `release` · `promote` · `rollback` 워크플로, 위협 모델 · 구조 문서 · TESTING.md |

순서: T1 ∥ T2 → T3 → T4, T5 는 T1 뒤 언제든.

**검증 (2026-11-02, macOS)**: 테스트 키로 서명한 0.0.1 · 0.0.2 디버그 번들과, 릴리스 스크립트로 만든 로컬 원본
(`python3 -m http.server`)으로 전 과정을 돌렸다. 0.0.1 이 `desk update check` 로 0.0.2 를 받아 검증 · 스테이징하고,
`desk update apply` 에 번들을 바꿔 0.0.2 로 다시 떴으며, 받아 둔 파일은 지워졌다. 3 OS 를 CI 에서 도는 업데이트
스모크(UPD-16)는 다음 단계다.

## 가정 (뒤집으려면 한 줄로)

1. 도메인은 `releases.endue.ai`, 버킷은 `endue-desk-releases`, 경로 접두사는 `desk/`.
2. 업데이터 키는 하나이고 인덱스 · 매니페스트 · 아티팩트를 같은 키로 서명한다. 키 롤오버는 2단계 절차(§검증).
3. Windows 는 NSIS 사용자별 설치만 업데이트한다. MSI 는 첫 설치용으로만 남긴다(기업 배포가 생기면 다시 본다).
4. Linux `.deb` · `.rpm` 업데이트는 `pkexec` 비밀번호 한 번을 받아들인다. 비밀번호 없는 길은 AppImage 다.
5. 받아 두기는 1단계에서 플러그인의 `download`(메모리 → 디스크)로 한다. 이어 받기(UPD-18)는 2단계.
6. 롤아웃 버킷의 salt 는 `<data>/updates/salt` 에 두고 기기 밖으로 내보내지 않는다.
7. 체크 주기 4 h · 시작 지연 30 s · 백오프 1 m / 5 m / 30 m 는 상수이고 설정이 아니다.
8. `desk.update.auto: false` 일 때의 "받기" 동작은 `update.download` 커맨드다(1단계에 포함, UI 는 같은 행).
9. 버전 `0.0.0` → 첫 stable `0.1.0`. 그 전의 main 빌드는 `0.1.0-pre.<run>`. 저장소의 버전 문자열은 바꾸지 않는다.
10. 적용은 세션 안에서는 받아 둘 때 만든 업데이트 핸들을 그대로 쓴다. 재시작 뒤에는 작은 `release.json` 을 한 번 다시
    받아 핸들을 만든다(플러그인의 `Update` 는 밖에서 만들 수 없다). 그래서 재시작 직후 오프라인이면 적용이 실패하고,
    받아 둔 판은 그대로 남는다.

## 하지 않는 것

- 델타 · 바이너리 패치 업데이트. 아티팩트는 통째로 받는다(200 MB 안쪽).
- 서버 쪽 판단(동적 엔드포인트). R2 는 정적 파일만 두고, 204 로 답하는 서버는 없다.
- 플러그인 업데이트. 그것은 마켓(MKT-03 · 04)의 일이고 다른 서명 키 · 다른 주기다.
- 강제 업데이트(사람이 미루지 못하는 판). `minFrom` 은 경로를 정할 뿐, 적용 시점은 늘 사람이다.
- 자동 다운그레이드. 롤백은 내리기 + 롤포워드다.

## 결정 (2026-11-02)

1. **macOS universal 은 내지 않는다.** `darwin-aarch64` 와 `darwin-x86_64` 를 따로 빌드 · 서명 · 게시한다. 아티팩트가
   하나 더 늘지만 내려받는 크기가 절반이다.
2. **릴리스 노트는 GitHub 에 둔다.** stable 은 태그마다 GitHub Release(자동 생성 노트, 바이너리 없이 R2 링크),
   canary · beta 는 그 빌드의 커밋 페이지. `release.json` 의 `notes` 는 그 주소이고, `desk.update.notes` 가 연다.
3. **canary 는 2주 보관한다.** canary 워크플로가 게시할 때마다 14일 지난 canary 판을 인덱스에서 내리고, beta ·
   stable 인덱스에 오르지 않은 판이면 `releases/<v>/` 도 지운다(UPD-20).
4. **적용은 사람의 몫이다(권장안).** `update:manage` 는 런타임과 CLI 에만 준다. 에이전트와 플러그인은
   `update.changed` 를 구독해 상태를 읽을 수 있고, 체크는 커맨드로 부를 수 있다. `desk.update.apply` 를 사람 아닌
   호출자가 부르면 런타임이 사람에게 먼저 묻는다. CLI 는 같은 OS 사용자의 손이라(ADR 0030) 묻지 않는다.

## 열린 질문

- [ ] Windows 서명 인증서의 종류(EV · Azure Trusted Signing). SmartScreen 평판이 쌓이기 전까지의 경고를 받아들일 것인가
