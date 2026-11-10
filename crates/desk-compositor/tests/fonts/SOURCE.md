# Test fonts

The text and theme snapshot tests draw with these fonts only, never the machine's, so a snapshot is
the same on every OS. Each is a subset of a variable font from the Google Fonts repository at commit
`5bb28733cec313b63fbd415b574b5ae35c8aa8b8`, cut down to the strings the tests draw. Licence: SIL Open
Font License 1.1 (`OFL-inter.txt`, `OFL-noto.txt`, the upstream `OFL.txt` files). The family names stay
the upstream ones: neither is a Reserved Font Name ("Source" is Noto CJK's).

| File | Upstream (`github.com/google/fonts/blob/<commit>/…`) | Upstream sha256 | Kept |
| --- | --- | --- | --- |
| `inter.ttf` | `ofl/inter/Inter[opsz,wght].ttf` | 29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031 | U+0020–007E, U+00A0, U+00B7, U+2013, U+2014, U+2018, U+2019, U+201C, U+201D, U+2026 |
| `noto-sans-kr.ttf` | `ofl/notosanskr/NotoSansKR[wght].ttf` | 194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252 | 설정 파일 터미널 메모 한글 제목 새 창 알림 다시 불러오기 잠든 저장했습니다 데스크 응답 없음 |
| `noto-sans-sc.ttf` | `ofl/notosanssc/NotoSansSC[wght].ttf` | a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da | 设置 文件 终端 窗口 桌面 通知 日本語 設定 漢字 ひらがな カタカナ 。、 |

Made with fonttools 4.60.1: `fonttools varLib.instancer --update-name-table <font> wght=400:700`
(Inter also `opsz=14`), then `pyftsubset <pinned> --unicodes=… (or --text-file=…) --no-hinting
--desubroutinize` (Inter with `--layout-features=kern,liga,calt,ccmp,locl,mark,mkmk`, the others `*`).
The `wght` axis stays, 400 to 700, so titles get their weight. A test that needs another character
needs a new subset: add it here.
