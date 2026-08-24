# Hello Mister v2.0

## Current Project Context

Start new work from `docs/CURRENT_PROJECT_CONTEXT.md`. It is the latest compact 기준 문서 for product direction, v1 sticker parity, MiSTer connection policy, Zaparoo/NFC behavior, ROM manager boundaries, INI management rules, banned operations, and the standard verification flow.

Future changes should stay issue-sized: read the context docs first, pick one `docs/BUG_QUEUE.md` issue or one user flow, update focused tests, run verification, then commit.

## Latest Hotfix: ROM Explorer PC Folder Tree

- The ROM file manager now shows a Windows Explorer-style PC folder tree inside the app instead of requiring a separate `PC folder` button flow.
- The PC pane keeps the two-pane explorer layout: local folder tree and local file list on the left side, MiSTer files on the right side.
- Expanding a PC tree node reads local folders through ROM-manager scoped IPC, and selecting a folder loads its files into the existing PC file list.
- PC-to-MiSTer and MiSTer-to-PC copy flows still use the existing ROM manager copy adapters.
- MiSTer remote writes remain limited to `/media/fat/games` and `/media/fat/_Arcade`. raw command IPC and unrestricted remote write IPC remain banned.

## Latest Hotfix: ROM Explorer Tree Navigation And Drag Copy

- Clicking a PC drive or folder row now opens the folder and expands the tree node in the same action.
- The PC folder tree scrolls inside its own pane, keeping the PC/MiSTer two-pane file explorer layout stable.
- `Backspace` and `Alt+Left` go back in the folder history for the pane currently under the mouse cursor. Text inputs keep their normal editing behavior.
- Drag-copy can target specific folders: PC files can be dropped onto MiSTer folder rows, and MiSTer files can be dropped onto PC tree folders or PC folder rows.
- This keeps the existing ROM manager adapters and guardrails. MiSTer writes remain restricted to `/media/fat/games` and `/media/fat/_Arcade`; raw command IPC and unrestricted remote write IPC remain banned.

## Latest Hotfix: File Manager Previous/Parent And Trash Delete

- The PC and MiSTer panes both expose visible `이전` and `상위` navigation buttons.
- The PC pane uses its local folder history and parent path, while the MiSTer pane uses its remote folder history and parent path.
- The central MiSTer trash view at `/media/fat/.hello-mister-trash` now has an explicit `영구 삭제` action for selected trash items.
- Permanent delete is implemented through a ROM-manager scoped IPC and is limited to children of `/media/fat/.hello-mister-trash`; deleting the trash root itself is blocked.
- The change does not add raw command IPC, unrestricted remote write IPC, or access to the v1 source folder.

## Latest Controller Management Scope

- Controller management can scan controller-related files from the active MiSTer profile and preview binary-like `.map` files as byte/hex data.
- `.map` filenames such as `1941r_input_16D0_1358_v3.map` are parsed as inferred game key, controller key, VID, PID, and version. These are filename-based estimates only.
- The controller screen can group maps by inferred joystick/controller key, game/core key, and byte length.
- Users can compare two `.map` files by byte offset, view hex/decimal differences, and summarize frequently changing offsets across files that share the same inferred controller key.
- A selected `.map` can be saved as a local controller map preset with byte length, bytesBase64, SHA-256, source path, controller key, and game key.
- Controller map analysis can be exported as lightweight ZIP, metadata-only JSON, file CSV, or advanced full-bytes ZIP. The recommended ZIP contains `controller-map-analysis.json`, per-file and per-group CSV files, and `README.txt` for upload to ChatGPT.
- Default exported map data is lightweight structured data only: file name, remote path, inferred game/controller key, VID/PID/version, byte length, SHA-256 when available, conservative platform guesses, and groups by controller, game, SHA-256, byte length, and platform. `bytesBase64`, `hex`, and `decimalBytes` are included only in explicit full-bytes exports.
- Controller management can build local preset candidates by grouping `.map` files with the same `controllerKey + byteLength + sha256`.
- The candidate view defaults to the dominant controller key and 128-byte maps, shows representative files and sample game keys, and keeps 2048-byte exception groups out of the default apply path.
- Saving a candidate opens an in-app modal with the selected SHA group, default name/type, notes, representative file selection, duplicate handling, and visible loading/error/success state.
- Candidate save reads only the selected representative `.map` file, verifies its SHA-256 against the group, and stores that byte payload locally with SHA, covered file count, sample game keys, and family label metadata.
- Duplicate candidate saves use `controllerKey + presetType + sha256` and let the user replace the existing local preset or save a separate copy.
- Full-bytes export is an advanced path for selected groups/files. Exporting every `.map` file with bytes requires a warning confirmation because it can be slow and large.
- The export keeps `matchedPlatform` separate from heuristic `platformGuess`; button meanings such as A/B/X/Y are never inferred from byte offsets.
- Preset application is dry-run only in this phase. The app shows diff, byte-length compatibility, controller-key warnings, target-path eligibility, and backup requirements, but it does not write remote `.map` files. Default eligibility requires the same controller key, the same byte length, and a target under `/media/fat/config/inputs/*.map`.
- The app does not infer button meanings such as A/B/X/Y from unknown byte offsets. raw command IPC, arbitrary SSH exec, unrestricted remote write, and plaintext credential storage remain banned.

## Latest Hotfix: Custom Platform Direct Source Scan

- Custom platform merge now direct-scans the registered `sourceRoot` with the existing read-only SFTP adapter when cached scan entries do not contain candidates.
- `/media/fat/_Arcade/PGM/<game folder>/<game>.mra` can be found from `/media/fat/_Arcade/PGM` without relying on a previous full `_Arcade` scan result.
- Custom platform candidates are filtered by `sourceRoot`, scan depth, and extension only; general import classification flags such as ignored/playable no longer hide user-registered custom source files.
- The custom platform panel exposes a `sourceRoot 스캔` action and shows raw/skipped diagnostics when candidates are still zero.
- This change does not add raw command IPC, remote write IPC, unrestricted scans, ROM explorer file operations, or plaintext credential storage.

## Latest Hotfix: Custom Platform Nested Scan

- Custom platform definitions now store `scanDepth` and `recursive` scan options.
- The default custom platform scan range is `scanDepth: 2` with `recursive: false`, so layouts like `/media/fat/_Arcade/PGM/<game folder>/<game>.mra` are included without opening an unrestricted recursive scan.
- The custom platform registration UI exposes scan range choices: direct files only, 2 levels, 3 levels, or explicit full recursive scan.
- `_Arcade/<folder>` read-only scan requests use bounded depth-2 SFTP listing by default. `/media/fat/games/<CORE>` keeps the one-level scan behavior.
- Nested `.mra` candidates keep their actual `fullMiSTerPath`/absolute path, and existing launch/NFC generation continues to build from that path.
- Generic nested filenames such as `game.mra` fall back to the parent folder name for the displayed game title.
- This change does not add raw command IPC, remote write IPC, ROM explorer file operations, or plaintext credential storage.

## Latest Hotfix: Sidebar Groups

- The sidebar top-level groups are now fixed to `MiSTer FPGA`, `스티커 제작`, and `설정`, in that order.
- Each top-level group is an expand/collapse parent. Parent clicks do not navigate; only child menu items navigate.
- `MiSTer FPGA` contains MiSTer connection, ROM management, SD card, INI, script, and controller screens. Basic mode shows only MiSTer connection, ROM management, and INI settings.
- `스티커 제작` contains the v1 sticker workflow routes and defaults to collapsed unless a sticker child route is active.
- `설정` contains app settings and advanced backup/restore.
- No feature logic changed in this hotfix. MiSTer connection, ROM explorer, INI save/backup/trash, Zaparoo/NFC, raw command IPC, remote write guards, and password storage policies are unchanged.

## Latest Hotfix: User-Facing Status Labels

- The main MiSTer connection screen now describes the shared connection as `MiSTer 연결됨` / `수동 연결 확인` instead of `읽기 전용 연결`.
- Feature-specific capability labels stay in their own screens:
  - ROM manager: `ROM 폴더 읽기/쓰기 가능` or `ROM 폴더 쓰기 권한 없음`
  - INI settings: `INI 편집 가능` or `INI 저장 권한 없음`
  - Zaparoo: `Zaparoo Core API 연결됨` or `Zaparoo API 응답 없음`
  - NFC: `NFC 리더 연결됨`
- The shared active MiSTer banner now uses `MiSTer 연결됨`, so it no longer conflicts with ROM/INI write capability checks.
- The manual connection policy is unchanged: the app does not connect on startup or immediately after saving. It connects only when the user clicks `연결`.
- This was a wording/status cleanup only. raw command IPC, unrestricted remote write IPC, plaintext password storage, and Electron major updates remain blocked.

## 최신 hotfix: INI 파일명과 시스템 경로 validator 분리

- INI 원본 파일명 validator는 `/media/fat/MiSTer.ini`, `MiSTer_alt_*.ini`, `MiSTer_*.ini` 같은 실제 INI 파일명에만 적용합니다.
- INI 백업 경로는 `/media/fat/.hello-mister-backups/ini/<원본 INI 파일명>/...` 아래의 timestamp 백업 파일만 별도 validator로 허용합니다.
- INI 휴지통 경로는 `/media/fat/.hello-mister-trash/ini/<timestamp>-<원본 INI 파일명>` 형식만 별도 validator로 허용합니다.
- INI 권한 확인용 `.hello-mister-ini-write-check.tmp`는 backup/trash 검사용 경로 validator로만 검증하며, `MiSTer_*.ini` 파일명 규칙을 강제로 적용하지 않습니다.
- `MiSTer_NM.ini` 같은 custom INI 저장과 휴지통 이동은 허용하고, `MiSTer.ini` 삭제 차단, path traversal, 허용 범위 밖 write, raw command IPC 금지는 그대로 유지합니다.

## 최신 hotfix: INI 저장/백업/휴지통 실행 보강

- `MiSTer_NM.ini`, `MiSTer_CRT.ini`, `MiSTer_example.ini` 같은 안전한 `MiSTer_이름.ini` custom INI는 저장/백업/휴지통 이동 흐름에서 허용됩니다.
- renderer validator는 원본 입력을 먼저 검증한 뒤 basename을 반환하므로 `../MiSTer_NM.ini` 같은 path traversal 입력은 계속 차단합니다.
- INI 저장은 현재 원격 INI 읽기, 원격 백업 생성, 새 INI 저장, 저장 후 원격 파일 다시 읽기, 백업 10개 유지 순서로 진행합니다.
- 저장 성공 후에는 목록을 새로고침하고 저장된 원격 INI를 다시 읽어 편집기 상태를 원격 파일 기준으로 갱신합니다.
- INI 휴지통 이동은 확인 후 휴지통 폴더 생성과 SFTP rename을 실행하고, 성공 시 일반 목록에서 제거한 뒤 휴지통 목록을 다시 읽습니다.
- INI write capability check는 백업 폴더 쓰기뿐 아니라 허용된 `MiSTer_*.ini` 임시 파일 생성과 INI 전용 휴지통 rename까지 확인합니다.
- 실패 시 `백업 생성`, `새 INI 저장`, `저장 후 다시 읽기`, `휴지통 폴더 생성`, `휴지통 이동` 같은 단계명이 포함된 안전한 오류 메시지를 표시합니다.
- 기본 `MiSTer.ini` 삭제 차단, INI 허용 경로 밖 write 차단, raw command IPC 금지, unrestricted remote write IPC 금지는 그대로 유지합니다.

## 최신 hotfix: custom MiSTer INI 휴지통 허용 회귀 보강

- INI 파일명 validator는 `MiSTer.ini`, `MiSTer_alt_1.ini`, `MiSTer_alt_2.ini`, `MiSTer_alt_3.ini`, 안전한 `MiSTer_이름.ini` 형식의 custom named INI를 허용합니다.
- `MiSTer_NM.ini`, `MiSTer_CRT.ini`, `MiSTer_example.ini` 같은 custom INI는 휴지통 이동 대상이 될 수 있습니다.
- 기본 `MiSTer.ini`는 파일명 자체는 허용하지만 삭제/휴지통 이동은 계속 차단합니다.
- `/`, `\`, `..`, null byte, `.ini`가 아닌 파일명, 허용 INI 경로 밖 원격 write는 계속 차단합니다.

## 최신 hotfix: INI 삭제/휴지통 사전 차단 완화

- 원격 `MiSTer_alt_*.ini`와 custom `MiSTer_이름.ini`의 휴지통 이동은 `iniWritable` 사전 확인 상태만으로 버튼이 막히지 않습니다.
- 휴지통 복구와 휴지통 영구 삭제도 사용자가 확인하면 INI 전용 제한 IPC까지 도달합니다.
- 실제 권한 부족, 파일명 오류, 경로 오류는 Electron main의 INI 전용 SFTP guard가 판단해 실패 메시지를 반환합니다.
- 기본 `MiSTer.ini` 삭제 차단, INI 전용 휴지통 경로 제한, raw command IPC 금지, unrestricted remote write 금지는 그대로 유지합니다.

## 최신 hotfix: custom MiSTer INI 파일명 허용

- INI 파일명 validator는 `MiSTer.ini`, `MiSTer_alt_*.ini`, 안전한 `MiSTer_이름.ini` 형식의 custom named INI를 허용합니다.
- `MiSTer_NM.ini`, `MiSTer_CRT.ini`, `MiSTer_example.ini` 같은 파일은 실제 MiSTer custom INI로 인식되어 목록/저장/휴지통 흐름에서 사용할 수 있습니다.
- 기본 `MiSTer.ini`는 계속 삭제 차단하고, alt/custom INI만 INI 전용 휴지통으로 이동할 수 있습니다.
- `/`, `\`, `..`, null byte, `.ini`가 아닌 파일명, 허용 경로 밖 write는 계속 차단합니다.

## 최신 hotfix: INI 휴지통 확인 후 실제 이동 실행

- INI 설정 화면에서 원격 `MiSTer_alt_*.ini` 또는 `MiSTer_*.ini` 삭제 확인을 누르면 즉시 “휴지통 이동 시작” 상태를 표시합니다.
- 확인 후 INI 전용 `iniFs:trashIni` IPC를 호출해 SFTP rename으로 `/media/fat/.hello-mister-trash/ini/` 아래로만 이동합니다.
- 성공 시 일반 INI 목록에서 대상 파일을 즉시 제거하고, 휴지통 패널을 열어 목록을 다시 읽습니다.
- 실패 시 한국어 오류 메시지를 표시하며 조용히 무반응으로 끝나지 않게 했습니다.
- `MiSTer.ini` 삭제 차단, INI 허용 경로 제한, raw command IPC 금지, unrestricted remote write 금지 정책은 그대로 유지합니다.

## 최신 hotfix: INI 주요 항목 한글 도움말 보강

- INI 설정 화면의 도움말은 `English Name (한글명)` 제목 아래 `설명`, `값 안내`, `추천`, `주의`, `원본 주석` 순서로 표시합니다.
- `key_menu_as_rgui`, `forced_scandoubler`, `vga_mode`, `ntsc_mode`, `composite_sync`, `vga_scaler`, `hdmi_audio_96k`, `keyrah_mode`, `vscale_mode`, `vscale_border`, `rbf_hide_datecode`, `menu_pal`, `hdmi_limited`, `direct_video`, `hdr`, `fb_size`, `fb_terminal`, `video_mode`, `refresh_min`, `refresh_max`는 사람이 직접 정리한 한국어 설명을 우선 사용합니다.
- 원본 INI 주석은 보조 정보로 유지하되, 주요 항목 설명을 주석 직역처럼 보이게 하지 않습니다.
- boolean 저장값 안내는 `OFF=0, ON=1로 저장됩니다.`로 통일했습니다.
- 이번 변경은 INI 도움말 문구와 회귀 테스트만 다룹니다. INI 저장, 백업, 휴지통, 원격 목록 새로고침, ROM 탐색기 로직은 변경하지 않았습니다.

## Latest Hotfix: 앱 모드와 스티커 사이드바 단순화

- 사용자에게 보이는 앱 모드는 이제 `기본`과 `고급` 두 가지뿐입니다.
- 기존 저장값은 `simple -> basic`, `developer -> advanced`로 자동 정리합니다.
- 직접 노출되는 개발자 도구 메뉴는 제거했습니다.
- appData, IPC, 작업 로그, 리포트, 정책, feature flag 같은 내부 진단 정보는 고급 모드의 접힌 섹션으로 이동했습니다.
- 기본 모드는 스티커 제작, MiSTer 연결, MiSTer 게임 롬 관리, 설정만 보여줍니다.
- 스티커 제작 parent 메뉴는 기본 시작 시 접혀 있으며, 클릭하면 하위 메뉴를 펼치고 다시 클릭하면 접습니다.
- `/stickers/...` route에 진입하면 스티커 하위 메뉴는 자동으로 펼쳐집니다.
- 스티커 제작 parent 클릭은 route 이동을 하지 않으며, 하위 메뉴 클릭만 v1 스티커 기능 route로 이동합니다.
- ROM 탐색기, INI 저장/백업/휴지통, raw command IPC 금지, password 평문 저장 금지 정책은 변경하지 않았습니다.

## 최신 hotfix: INI 도움말 문구 단순화

- INI 도움말 팝업은 `설명`, `값 안내`, `추천`, `주의`, `원본 주석` 구조로 단순화했습니다.
- catalog에 설명이 있는 항목은 기존 한글 설명을 사용합니다.
- catalog에 설명이 없고 원본 INI 주석이 있는 항목은 그 주석을 한글 설명으로 보여주고, 원문 주석은 하단에 작게 표시합니다.
- 원본 주석도 없는 항목은 현재 INI에 포함된 설정임을 짧게 안내하고, 의미가 확실하지 않으면 기존 값을 유지하도록 안내합니다.
- 도움말에서 출처/등급/변경 방법 같은 내부성 문구는 제거했습니다.
- INI 저장, 백업, 휴지통, 원격 write 허용 범위, raw command IPC 금지 정책은 변경하지 않았습니다.

## 최신 hotfix: INI 도움말 팝업 중복 제거

- INI 항목의 `?` 도움말은 hover와 click 모두 같은 `IniHelpPopover` 하나만 사용합니다.
- 항목명/help 아이콘의 native `title` tooltip을 제거해 브라우저 기본 tooltip과 custom popover가 동시에 뜨지 않게 했습니다.
- `?`를 hover하면 기존 팝업이 보이고, click하면 같은 팝업이 고정됩니다. 다른 도움말을 열거나 팝업 밖을 클릭하면 이전 팝업은 닫힙니다.
- 자세한 한글 설명, 값 안내, 추천/주의, 원본 주석은 모두 기존 첫 팝업 안에 통합되어 표시됩니다.

## 최신 hotfix: INI fallback 도움말과 토글 안전성

- INI catalog에 등록되지 않은 key도 빈 안내로 끝나지 않도록 fallback 도움말을 생성합니다.
- 원본 INI 주석이 있으면 먼저 한국어 추정 설명으로 풀어 쓰고, 원본 주석은 별도 섹션에 함께 표시합니다.
- 원본 주석이 없는 항목은 key 이름, 현재 값 형식, 카테고리 추정값을 기반으로 역할/현재 값 의미/변경 방법/주의사항을 안내합니다.
- 불확실한 항목은 단정하지 않고 “설정으로 보입니다”, “공식 문서나 원본 주석을 확인하세요”처럼 보수적으로 표시합니다.
- INI 항목 row, 항목 이름, 도움말 버튼, 빈 영역 클릭만으로는 ON/OFF 값이 바뀌지 않습니다.
- 값 변경은 checkbox/switch, select, text/number input 같은 실제 입력 컨트롤을 직접 조작할 때만 일어납니다.
- 자동 저장은 계속 꺼져 있으며, dirty 상태는 실제 값 변경이 발생한 경우에만 켜집니다.
- 이번 변경은 INI 표시/도움말/클릭 범위만 다룹니다. INI 목록 새로고침, PC INI 가져오기, 저장, 백업, 휴지통, 원격 write 제한 정책은 변경하지 않았습니다.

## 최신 hotfix: INI 항목 라벨/도움말 정리

- INI GUI 편집기의 항목명은 `English Name (한국어 이름)` 형식으로 표시합니다. 예: `Composite Sync (컴포지트 싱크)`, `Direct Video (다이렉트 비디오)`, `VGA Mode (VGA 모드)`.
- 실제 INI key는 항목명 아래에 작은 보조 텍스트로 유지합니다. 예: `composite_sync`.
- `?` 도움말 버튼은 hover/focus에서 한글 설명, 사용 시점, 입력값/범위, 권장/주의, 원본 INI 주석, 저장값 정보를 보여줍니다.
- `0`/`1` boolean 값은 계속 ON/OFF 토글로 표시하며, 도움말에는 `OFF=0, ON=1로 저장됩니다.`를 명시합니다.
- 숫자/텍스트 입력에는 허용 범위나 예시 placeholder/hint를 표시하고, enum/select 항목은 가능한 값과 한글 label을 함께 보여줍니다.
- 위험한 영상 출력 관련 항목은 주의/위험 badge로 표시합니다. 단, 정확하지 않은 값은 임의로 강제하지 않고 “환경에 따라” 조정이 필요하다고 안내합니다.
- 이번 변경은 표시/도움말/입력 안내만 다룹니다. INI 목록 새로고침, PC INI 가져오기, 저장, 백업, 휴지통, 원격 write 제한 정책은 변경하지 않았습니다.

## 최신 hotfix: INI 값과 주석 분리

- INI 편집기는 `key=0 ; 설명`처럼 값 뒤에 붙은 줄 끝 주석을 입력값으로 취급하지 않습니다.
- `0`/`1` 값은 기본 모드에서 ON/OFF 토글로 표시하고, 저장 시에는 원래 INI 형식에 맞게 `0` 또는 `1`로 기록합니다.
- 줄 끝 주석과 원본 INI 주석은 hover 도움말로 이동했습니다. 기본 모드 입력칸에는 실제 값만 표시하고, 원본 줄은 개발자 모드에서만 확인합니다.
- 저장 시 기존 줄 끝 주석은 보존합니다. 자동 저장은 하지 않고 저장 버튼을 눌렀을 때만 백업 후 원격 INI에 반영합니다.
- raw command IPC, unrestricted remote write IPC, INI 허용 범위 밖 write, password 평문 저장 정책은 변경하지 않았습니다.

## 최신 hotfix: 실제 INI 출처와 GUI 값 컨트롤 정리

- INI 설정 화면은 연결된 active MiSTer의 `/media/fat` 루트에서 `MiSTer.ini`, `MiSTer_alt_1.ini`, `MiSTer_alt_2.ini`, `MiSTer_alt_3.ini`, `MiSTer_*.ini`를 다시 읽습니다. `.INI` 확장자도 안전하게 인식합니다.
- 새로고침 결과는 appData metadata/cache와 병합하지만, 원격에 실제 존재하는 파일을 우선합니다. cache만 남은 항목은 `원격 없음`으로 표시합니다.
- PC에서 INI를 가져오면 즉시 목록에 표시됩니다. 사용자는 로컬 보관 또는 업로드 준비 상태를 선택할 수 있고, MiSTer에 저장하기 전에는 원격 파일을 수정하지 않습니다.
- INI 목록과 선택 상세에는 `원격`, `로컬`, `업로드 준비`, `캐시`, `원격 없음` 출처 배지가 표시됩니다. 선택 상세에는 현재 파일명, 출처, 대상 MiSTer 별칭/IP가 함께 표시됩니다.
- 값이 `0`/`1`인 항목은 기본적으로 ON/OFF 토글로 표시하고, 저장 시 원래 INI 형식에 맞게 `0`/`1` 계열 값으로 저장합니다.
- key 옆 도움말은 hover tooltip으로 제공하며, `iniHelpCatalog.ts`의 한글 설명을 우선하고 원본 INI 주석이 있으면 함께 보여줍니다.
- 변경 사항은 자동 저장하지 않습니다. 저장 버튼을 누를 때만 백업 생성 후 원격 INI에 반영합니다.
- raw command IPC, unrestricted remote write IPC, ROM 탐색기, SD 플래시, 스크립트 실행, password 평문 저장 정책은 변경하지 않았습니다.

## 최신 변경: 실제 MiSTer INI 설정 관리

- INI 설정 메뉴는 이제 mock 프리셋이 아니라 현재 연결된 `activeMisterProfile`의 `/media/fat` 루트에서 실제 INI 목록을 읽습니다.
- 탐색 대상은 `MiSTer.ini`, `MiSTer_alt_1.ini`, `MiSTer_alt_2.ini`, `MiSTer_alt_3.ini`, `MiSTer_*.ini`입니다.
- 선택한 INI는 텍스트 편집기 대신 섹션별 GUI 항목으로 표시하며, 주석은 해당 key의 도움말 후보로 연결합니다.
- 값은 자동 저장하지 않습니다. 사용자가 저장 버튼을 눌렀을 때만 적용하며, 저장 전 대상 MiSTer/파일/변경 항목/백업 예정 내용을 확인합니다.
- 저장 전 원격 백업을 `/media/fat/.hello-mister-backups/ini/<fileName>/<timestamp>.ini`에 만들고, INI 파일당 최근 10개만 유지합니다.
- 가칭 이름, 프리셋 슬롯, 메모는 원격 INI에 쓰지 않고 v2 appData의 `mister-ini/<profileId>/ini-metadata.json`에 저장합니다.
- INI 삭제는 기본 INI인 `MiSTer.ini`에는 허용하지 않으며, custom/alt INI만 `/media/fat/.hello-mister-trash/ini/`로 이동합니다.
- INI 전용 IPC만 추가했습니다. 허용 원격 write 범위는 `/media/fat/MiSTer*.ini`, `/media/fat/.hello-mister-backups/ini/**`, `/media/fat/.hello-mister-trash/ini/**`로 제한됩니다.
- raw command IPC, unrestricted remote write IPC, ROM 탐색기 기능, SD 플래시, 스크립트 실행, 컨트롤러 관리는 이번 작업에서 변경하지 않았습니다.

## 최신 hotfix: 게임 리스트 동기화 active MiSTer 스캔

- 스티커 제작 > 미스터 게임 리스트 > 게임 리스트 동기화의 "연결된 MiSTer 스캔"은 더 이상 별도 v1 bridge session만 요구하지 않습니다.
- 사용자가 MiSTer 연결 메뉴에서 한 번 연결한 activeMisterProfile을 기준으로 Electron main active profile을 다시 hydrate하고, 기존 read-only SSH/SFTP IPC로 `/media/fat/games`를 스캔합니다.
- SSH session id가 화면 이동 중 비어 있으면 safeStorage에 저장된 MiSTer 비밀번호를 사용해 read-only 연결을 재생성한 뒤 같은 scan 흐름을 이어갑니다.
- 앱 시작 자동연결과 저장 후 자동연결은 계속 비활성입니다. 이 재연결은 사용자가 이미 "연결"을 눌러 active profile을 만든 뒤의 read-only 작업 재사용에만 적용됩니다.
- 기본 모드 사용자 메시지에서 "bridge session" 표현을 제거하고, MiSTer 연결 필요, 인증 실패, 신뢰 키 문제, `/media/fat/games` 읽기 실패를 구분해 표시합니다.

## 최신 hotfix: NFC 태그 읽기/검증

- NFC 태그 쓰기는 Zaparoo `readers.write`를 사용하지만, 태그 읽기/검증은 `readers.read`가 아니라 Zaparoo token event 흐름을 사용합니다.
- “태그 읽기”를 누르면 Electron main process가 `http://<MiSTer IP>:7497/api/v0.1/events` SSE endpoint를 구독하고 `tokens.added` 이벤트를 한 번 기다립니다.
- 사용자는 읽기 시작 후 태그를 리더에서 뗐다가 다시 올려 새 scan event를 만들어야 합니다.
- `tokens.added`에서 읽은 text/payload를 현재 NFC payload와 비교해 일치하면 검증 성공, 다르면 “다른 데이터가 기록되어 있습니다”, 시간 초과면 “태그를 감지하지 못했습니다”로 표시합니다.
- event 구독이 열리지 않는 환경에서는 고정 JSON-RPC `tokens` / `tokens.history` fallback만 시도합니다. 임의 JSON-RPC IPC나 raw command IPC는 추가하지 않았습니다.
- 쓰기 후에는 바로 검증 결과를 가정하지 않고, 태그를 뗐다가 다시 올린 뒤 “태그 읽기”로 확인하도록 안내합니다.

## 최신 hotfix: Zaparoo run 실패 진단 세분화

- Zaparoo 실행 실패는 이제 `API_OFFLINE`, `API_ENDPOINT_FAILED`, `RUN_METHOD_FAILED`, `RUN_ENDPOINT_FAILED`, `ALLOW_RUN_MISSING`, `ALLOW_RUN_BLOCKED`, `ALLOWED_IPS_BLOCKED`처럼 원인별로 분류합니다.
- 앱은 연결된 MiSTer에서 `/media/fat/zaparoo/config.toml`을 SFTP read-only로 읽어 `[service] allow_run`과 `allowed_ips` 상태를 진단합니다.
- `allow_run`이 없거나 빈 배열이면 원격 실행이 차단될 수 있다고 안내하고, 패턴이 있으면 개수를 표시합니다.
- `allowed_ips`가 제한되어 있으면 현재 PC IP가 허용 범위인지 확인하라는 안내를 표시합니다.
- 앱은 Zaparoo `config.toml`을 자동 수정하지 않습니다. 설정 변경은 사용자가 MiSTer/Zaparoo 쪽에서 직접 수행해야 합니다.
- 카드 앨범 실행 실패 화면은 기본 모드에서 짧은 메시지를, 개발자 모드에서 run method, `/run/` fallback, config 진단 상세를 표시합니다.

## 작업 방식

- 앞으로는 큰 프롬프트 하나로 전체 기능을 한 번에 작업하지 않습니다.
- 작업 전에 `docs/PRODUCT_RULES.md`, `docs/MENU_STRUCTURE.md`, `docs/V1_STICKER_PARITY.md`를 먼저 확인합니다.
- 버그 수정은 `docs/BUG_QUEUE.md`의 이슈 하나씩 처리합니다.
- 한 작업은 한 이슈 또는 하나의 사용자 흐름만 다룹니다.
- v1 스티커 기능은 새 MVP나 placeholder로 대체하지 않습니다.
- 기존 v1 폴더 `<v1 참조 폴더(zaparoo-nfc-card-stickers)>`는 읽기 전용 참고 자료로만 사용합니다.
- 작업 후 `npx tsc --noEmit`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run test`를 실행합니다.
- Electron UI 변경이면 `npm.cmd run package:review`와 `npm.cmd run smoke:electron`도 실행합니다.
- 커밋 메시지는 `fix: ...`, `milestone: ...`, `docs: ...`처럼 작업 성격이 보이게 작성합니다.
- raw command IPC, 평문 password 저장, 무분별한 원격 쓰기, `npm audit fix`, Electron major update는 별도 명시 작업 없이는 하지 않습니다.

### 기준 문서

- `docs/PRODUCT_RULES.md`
- `docs/MENU_STRUCTURE.md`
- `docs/V1_STICKER_PARITY.md`
- `docs/MISTER_CONNECTION_SPEC.md`
- `docs/ZAPAROO_FLOW.md`
- `docs/MANUAL_QA_CHECKLIST.md`
- `docs/BUG_QUEUE.md`

## 최신 hotfix: 미스터 게임 리스트 연결 중복 제거와 Zaparoo allow_run 진단

- 스티커 제작 > 미스터 게임 리스트 안의 별도 “연결” 항목은 숨기고, 연결 관리는 메인 “MiSTer 연결” 메뉴 하나로 통합했습니다.
- 미스터 게임 리스트는 현재 active MiSTer 상태를 사용하며, 연결이 없으면 “MiSTer 연결로 이동” 안내만 표시합니다.
- Zaparoo 실행 실패 안내는 공식 설정명인 `[service] allow_run` 기준으로 정리했습니다. 이전의 잘못된 설정명은 사용하지 않습니다.
- Zaparoo config 진단은 `/media/fat/zaparoo/config.toml`을 SFTP read-only로 읽어 `allow_run`과 `allowed_ips` 상태만 확인합니다.
- 앱은 Zaparoo config.toml을 자동 수정하지 않습니다. 설정 변경은 사용자가 MiSTer/Zaparoo 쪽에서 직접 수행해야 합니다.

## 최신 변경: Zaparoo 실행/NFC 연결

- Hello Mister v2.0은 v1 스티커 앱의 카드 앨범, 미스터 게임 리스트, NFC 관리 흐름을 Zaparoo Core API에 연결합니다.
- Zaparoo Core API는 JSON-RPC 2.0 HTTP POST를 사용하며 기본 대상은 `http://<MiSTer IP>:7497/api/v0.1`입니다.
- 사용하는 고정 메서드는 `version`, `health`, `media.search`, `media.browse`, `media.lookup`, `run`, `readers`, `readers.write`입니다.
- 카드 앨범과 미스터 게임 리스트의 실행 버튼은 Zaparoo `run`을 먼저 사용하고, 실패 시 `/run/<encoded ZapScript>` fallback을 시도합니다.
- 게임 리스트의 NFC 버튼은 NFC 관리 화면으로 선택 게임/실행 경로를 전달합니다.
- 카드 앨범의 NFC 아이콘은 현재 active MiSTer의 Zaparoo reader에 바로 `readers.write`를 요청합니다.
- `media.search`, `media.browse`, `media.lookup`은 게임 리스트 항목과 Zaparoo media database를 연결하기 위한 후보 조회에 사용합니다.
- remote `/run/` 실행이 실패하면 MiSTer의 `/media/fat/zaparoo/config.toml`에서 `[service] allow_run` 규칙을 확인해야 합니다. 앱은 이 파일을 자동 수정하지 않고 읽기 전용 진단만 수행합니다.
- Zaparoo mappings 위치는 `/media/fat/zaparoo/mappings`입니다.
- raw SSH command, 임의 명령 실행 IPC, ROM copy/upload, 원격 mkdir/rename/delete/overwrite, SD 포맷/플래싱은 계속 잠겨 있습니다.
- 기존 v1 폴더는 읽기 전용 참고 자료이며, 패키징된 v2는 v2 내부 이식본과 appData만 사용합니다.

Hello Mister v2.0은 기존 카드 스티커 제작 앱을 수정하지 않고 새로 시작한 MiSTer FPGA 관리용 독립 프로젝트입니다.

## 작업 원칙

- 기존 앱 폴더 `<v1 참조 폴더(zaparoo-nfc-card-stickers)>`는 읽기 전용 참고 자료입니다.
- 새 프로젝트는 `<프로젝트 루트>` 안에서만 수정합니다.
- 기존 카드, 템플릿, 이미지 캐시, NFC, MiSTer 연결 로직은 수정하거나 마이그레이션하지 않습니다.
- 원격 쓰기, 삭제, reboot, SD 포맷/플래싱은 안전 설계가 끝날 때까지 disabled 또는 dry-run 상태로 둡니다.
- password, private key, passphrase, token은 파일, localStorage, appData, 작업 로그, 진단 패키지에 저장하지 않습니다.

## 현재 구현 범위

- Electron + Vite + React + TypeScript 앱 구조
- 좌측 메뉴 기반 10개 페이지
- MiSTer 자동검색 UI와 Electron main process 기반 포트 후보 탐색
- Windows 드라이브/SD 카드 읽기 전용 감지
- SSH/SFTP 기반 read-only MiSTer fingerprint
- session-only SSH 인증과 세션 인증 지우기
- SSH host key 신뢰 저장소와 변경 이력
- host key 비교 modal
- 원격 오류 guide map
- 영구 작업 로그 `task-log.json`
- 프로필 summary cache `mister-profile-summary.json`
- 원격 MiSTer.ini 미리보기
- `/media/fat/games` 1단계 폴더 조회
- `/media/fat/Scripts` `.sh` 목록/내용 미리보기
- 로컬 JSON 진단 패키지 생성
- ROM 관리 dry-run 타입/서비스 skeleton

## MiSTer 자동검색 방식

MiSTer의 기본 hostname은 여러 장치가 모두 `MiSTer`일 수 있으므로 hostname만으로 구분하지 않습니다.

검색과 표시 기준:

- 저장된 프로필 우선 표시
- PC 네트워크 인터페이스의 private IPv4 `/24` 후보 생성
- SSH 22, SMB 445, HTTP 80 포트 체크
- 22 또는 445가 열려 있으면 후보 장치로 표시
- 인증 후 `/media/fat`, `/media/fat/games`, `/media/fat/Scripts`, `/media/fat/MiSTer.ini`, hostname, MAC 주소를 read-only로 확인
- 사용자가 지정한 별칭이 있으면 별칭 우선
- 별칭이 없고 hostname이 중복되면 `MiSTer @ IP / MAC 끝 4자리` 형식 사용

## SSH/SFTP session-only 인증

인증 정보는 다음 흐름으로만 사용합니다.

1. 사용자가 MiSTer 연결 페이지에서 host, port, username, password 또는 private key를 입력합니다.
2. renderer는 preload IPC를 통해 Electron main process에 요청합니다.
3. main process는 인증 정보를 memory session에만 보관합니다.
4. 앱 재시작 또는 “세션 인증 지우기” 후 인증 정보는 남지 않습니다.

저장하지 않는 항목:

- password
- private key
- passphrase
- token
- raw credential
- private key 전체 경로

프로필에 저장 가능한 항목:

- alias
- IP
- hostname
- MAC
- lastSeen
- connectionMethod

## SSH host key 신뢰와 변경 이력

known hosts 저장소:

- `known-ssh-hosts.json`
- host, port, fingerprint, keyType, firstSeen, lastSeen, profileId, alias만 저장합니다.
- 로그인 인증 정보는 저장하지 않습니다.

host key 변경 이력:

- `known-ssh-host-history.json`
- old/new fingerprint, old/new keyType, detectedAt, profileId, alias, action을 저장합니다.
- mismatch가 발생해도 자동 교체하지 않습니다.
- 사용자가 기존 신뢰를 제거한 뒤 새 키를 신뢰해야 합니다.

## 원격 오류 코드

원격 오류는 다음 코드로 분리합니다.

| 코드 | 의미 |
| --- | --- |
| `NETWORK_TIMEOUT` | 해당 IP에서 응답 없음 |
| `CONNECTION_REFUSED` | 포트가 닫혔거나 서비스가 거부 |
| `HOST_KEY_UNTRUSTED` | 처음 보는 SSH host key |
| `HOST_KEY_MISMATCH` | 저장된 fingerprint와 현재 fingerprint가 다름 |
| `AUTH_FAILED` | 사용자명/비밀번호/key 인증 실패 |
| `SSH_NEGOTIATION_FAILED` | SSH handshake 또는 알고리즘 문제 |
| `SFTP_UNAVAILABLE` | SSH는 되었지만 SFTP 조회 불가 |
| `REMOTE_PATH_MISSING` | 필수 원격 경로 없음 |
| `NOT_MISTER` | `/media/fat` 구조가 없어 MiSTer로 확정 불가 |
| `READ_PERMISSION_DENIED` | 읽기 권한 부족 |
| `COMMAND_BLOCKED` | 안전 정책상 차단 |
| `UNKNOWN_REMOTE_ERROR` | 분류되지 않은 원격 오류 |

## 6차 작업: 실제 MiSTer read-only 수동 검증 흐름

6차에서는 실제 장치를 대상으로 안전하게 확인할 수 있는 앱 내부 절차를 정리했습니다.

검증 흐름:

1. 장치 프로필 선택
2. SSH/SFTP 세션 인증 입력
3. host key fingerprint 확인
4. host key 신뢰 등록
5. read-only fingerprint 실행
6. `/media/fat` 구조 확인
7. 원격 MiSTer.ini 미리보기 확인
8. games 1단계 폴더 목록 확인
9. Scripts 목록 확인
10. 진단 패키지 dry-run 생성
11. 결과를 프로필 summary cache에 저장

각 단계는 `대기`, `진행 중`, `성공`, `실패`, `건너뜀`, `차단됨` 상태를 가집니다.

차단 조건:

- 프로필 없음
- session-only 인증 없음
- 신뢰된 host key 없음
- host key mismatch

## Profile summary cache

파일 예시:

- `mister-profile-summary.json`

저장 가능한 항목:

- profileId
- alias
- host / port
- hostname / MAC
- lastSeen
- lastSuccessfulReadAt
- lastFailedReadAt
- lastErrorCode
- hostKeyTrustStatus
- fingerprintSummary
- `/media/fat`, games, Scripts, MiSTer.ini, downloader.ini 상태
- storageSummary
- gameFolderCount
- scriptCount
- readOnlyTestStatus
- readOnlyTestDurationMs

저장하지 않는 항목:

- password
- privateKey
- passphrase
- token
- raw credential
- raw command
- private key 전체 경로

## 작업 큐/최근 작업 로그

작업 로그는 appData의 `task-log.json`에 저장됩니다.

- 최근 100개만 보관
- read-only/dry-run 여부 표시
- errorCode와 sanitizedErrorMessage 기록
- JSON 내보내기 지원
- 전체 삭제 버튼 제공
- secret 계열 값은 저장 전 제거

## ROM 관리 dry-run 준비

이번 단계에서 실제 ROM 복사/삭제/덮어쓰기는 구현하지 않았습니다.

준비된 구조:

- `RomFileCandidate`
- `RomTargetFolder`
- `RomCopyPlan`
- `RomConflict`
- `RomDryRunResult`
- `RomPlanningService`
- `RomConflictService`
- `RomStorageCheckService`

현재 가능한 동작:

- 샘플 ROM 복사 계획 생성
- 대상 코어 폴더 추천 구조
- 충돌/용량 검사 service skeleton

계속 비활성:

- 로컬 ROM 실제 선택 후 원격 복사
- 원격 ROM 삭제
- 원격 ROM 덮어쓰기
- 다른 MiSTer로 복사

## 계속 차단된 위험 기능

- 원격 파일 수정/삭제/rename/chmod/chown
- 원격 reboot/shutdown/hostname 변경
- MiSTer.ini 원격 업로드/덮어쓰기
- ROM 추가/삭제/복사
- 스크립트 실행
- SD 카드 포맷
- SD 카드 플래싱
- renderer raw command IPC

## Mr. Fusion SD 카드 만들기

현재는 안전한 마법사 UI와 service interface만 있습니다.

가능한 구조:

- 로컬 이미지 선택
- checksum/hash 입력/검증 구조
- Windows removable drive 목록 표시
- dry-run 플래시 계획
- `MRFUSION` 볼륨 사전 설정 staging 설계

아직 실행하지 않는 작업:

- 실제 포맷
- 실제 플래싱
- 파티션 수정
- 자동 reboot

## INI 프리셋 적용 방식

INI 프리셋은 GUI와 diff preview 중심으로 설계되어 있습니다.

계획된 적용 방식:

1. 선택한 프리셋을 `/media/fat/MiSTer.ini`로 복사하고 reboot
2. 선택한 프리셋을 `/media/fat/MiSTer_프로필명.ini`로 저장하고 사용자가 OSD에서 선택

현재는 원격 적용/재부팅이 disabled입니다. 로컬 파일 내보내기와 원격 MiSTer.ini 읽기/미리보기만 허용합니다.

## 실행 명령

```powershell
npm install
npm run lint
npm run build
npm run test
npm run dev
```

## npm audit 상태

2026-05-27 기준 `npm audit --audit-level=high` 결과:

- `electron <=39.8.4` high severity advisory 1건이 남아 있습니다.
- npm 제안은 `electron@42.3.0` 강제 업데이트이며 breaking change 가능성이 있습니다.
- 사용자 지시에 따라 `npm audit fix`와 Electron major update는 실행하지 않습니다.

## 다음 단계 제안

1. 실제 MiSTer 장치에서 read-only 통합 테스트를 수동 검증합니다.
2. host key 최초 신뢰와 mismatch UX를 실제 네트워크에서 확인합니다.
3. ROM 관리 dry-run을 실제 로컬 파일 선택과 충돌 계획 생성으로 확장합니다.
4. 원격 쓰기 기능은 백업, preview, 다중 확인, 작업 큐 rollback 설계가 끝난 뒤 별도 adapter로 검토합니다.
5. Electron audit advisory는 릴리스 전 별도 브랜치에서 major update 영향을 검증합니다.

## 7차 작업: ROM 가져오기 dry-run 계획

7차 작업에서는 실제 ROM 복사 없이 로컬 파일을 읽고 MiSTer 대상 폴더를 추천하는 계획 단계까지만 구현했습니다.

### ROM dry-run 범위

- 로컬 ROM 파일 선택과 로컬 ROM 폴더 선택을 지원합니다.
- 폴더 선택은 기본 1단계만 스캔합니다.
- 재귀 스캔은 사용자가 명시적으로 켜는 옵션이며, 기본값은 꺼짐입니다.
- 파일 metadata는 파일명, 전체 경로, 확장자, 크기, 수정일까지만 읽습니다.
- SHA-256 hash는 자동으로 계산하지 않고, 사용자가 파일별로 요청할 때만 계산합니다.
- 실제 원격 복사, 삭제, rename, overwrite는 구현하지 않았습니다.

### 플랫폼/코어 폴더 추천 방식

추천은 다음 순서로 계산합니다.

1. 사용자가 직접 선택한 플랫폼 override
2. 확장자 기반 후보
3. 파일명/폴더명 키워드
4. 원격 `/media/fat/games` 1단계 폴더 목록과의 일치 여부

대표 매핑:

- `.nes` → NES
- `.sfc`, `.smc`, `.bs` → SNES
- `.md`, `.gen`, `.smd` → Genesis / MegaDrive
- `.sms` → SMS
- `.gg` → GameGear
- `.gb` → Gameboy
- `.gbc` → GBC
- `.gba` → GBA

자동 확정하지 않는 형식:

- `.zip`
- `.cue`
- `.bin`
- `.chd`
- `.iso`
- `.vhd`

이 파일들은 Arcade, NeoGeo, CD 기반 코어, PC 계열 등 여러 가능성이 있으므로 “플랫폼 선택 필요” 상태로 표시합니다.

### 원격 games 폴더 비교

기본 MiSTer 프로필, session-only 인증, trusted host key가 있을 때만 원격 비교를 수행합니다.

- `/media/fat/games`의 1단계 코어 폴더 목록을 읽습니다.
- 추천 대상 폴더가 실제로 있는지 확인합니다.
- 대상 폴더의 1단계 파일 목록만 읽어 같은 파일명이 있는지 확인합니다.
- 깊은 재귀 ROM 스캔이나 원격 파일 다운로드는 수행하지 않습니다.

충돌 타입:

- `none`: 복사 계획 가능
- `sameNameSameSize`: 같은 이름과 같은 크기의 파일이 있어 동일 가능성이 높음
- `sameNameDifferentSize`: 같은 이름이지만 크기가 달라 충돌
- `targetFolderMissing`: 원격 대상 폴더 없음
- `ambiguousPlatform`: 플랫폼 후보가 여러 개
- `unsupportedExtension`: 지원하지 않는 확장자
- `remoteReadFailed`: 원격 목록 읽기 실패
- `needsManualPlatform`: 사용자가 플랫폼을 선택해야 함

### 저장공간 dry-run

- 원격 `/media/fat` 저장공간 정보를 읽어 복사 계획 가능성을 계산합니다.
- 확정된 대상 파일의 총 크기를 계산합니다.
- 안전 여유 공간은 `1GB`와 전체 용량의 `5%` 중 큰 값으로 잡습니다.
- 결과는 충분함, 여유 부족 경고, 부족함, 확인 실패로 표시합니다.

### 복사 계획 JSON

복사 계획은 다음 정보를 포함합니다.

- planId
- createdAt
- sourceFiles
- targetProfileId / targetAlias / targetHost
- targetBasePath: `/media/fat/games`
- perFilePlan
- totalSizeBytes
- requiredFreeBytes
- remoteFreeBytes
- dryRun: true
- readOnly: true

기본 JSON 내보내기는 로컬 전체 경로를 숨기고 파일명 중심으로 저장합니다. 사용자가 명시적으로 선택하면 로컬 전체 경로를 포함할 수 있습니다.

### 계속 차단된 기능

- 원격 ROM 실제 복사
- 원격 ROM 삭제
- 원격 ROM rename/overwrite
- 원격 폴더 생성
- MiSTer 원격 파일 수정
- MiSTer reboot/shutdown
- 스크립트 실행
- SD 카드 포맷/플래싱
- renderer raw command IPC

### 다음 단계 제안

1. 실제 MiSTer에서 ROM dry-run 원격 비교를 수동 검증합니다.
2. 플랫폼 추천 매핑을 MiSTer 코어 폴더 관례에 맞게 확장합니다.
3. 대량 ROM 스캔 성능과 진행률 UI를 추가합니다.
4. 실제 복사 기능은 백업, 충돌 해결, 다중 확인, rollback 설계가 끝난 뒤 별도 adapter로 검토합니다.

## 8차 작업: ROM 전송 전 안전 정책

8차 작업에서는 실제 ROM 복사를 열기 전에 필요한 안전 정책 UI와 service skeleton을 추가했습니다. 이번 단계도 원격 쓰기는 실행하지 않습니다.

### 충돌 해결 정책

충돌 타입별 기본 정책은 다음과 같습니다.

- `none`: `copyLater`
- `sameNameSameSize`: `skip`
- `sameNameDifferentSize`: `needsUserDecision`
- `targetFolderMissing`: `needsUserDecision`
- `ambiguousPlatform`: `needsUserDecision`
- `unsupportedExtension`: `block`
- `remoteReadFailed`: `block`
- `needsManualPlatform`: `needsUserDecision`

사용자는 파일별 action 드롭다운으로 다음 계획 상태를 선택할 수 있습니다.

- `skip`
- `replaceLater`
- `renameLocalFileLater`
- `createFolderLater`
- `chooseDifferentFolder`
- `block`

action 변경은 복사 계획 summary를 다시 계산하지만 실제 파일 작업은 수행하지 않습니다.

### 대상 폴더 생성 dry-run 정책

대상 폴더가 없는 항목은 `createFolderLater` 계획으로 표시할 수 있습니다. 이 계획은 다음 검증만 수행합니다.

- 빈 이름 금지
- `/`, `\` 경로 구분자 금지
- `..` 금지
- 절대경로 금지
- `/media/fat/games` 밖으로 나가는 경로 금지

실제 `mkdir` 또는 원격 폴더 생성 코드는 구현하지 않았습니다.

### 복사 전 백업 계획

`replaceLater` 항목은 백업 필요 대상으로 표시됩니다.

백업 계획에는 다음 정보가 포함됩니다.

- remotePath
- fileName
- sizeBytes
- backupTargetLocalPathPreview
- backupReason
- requiredBeforeCopy: true

이번 단계의 기본 정책은 로컬 백업 계획 우선이며, 실제 백업 파일 생성과 원격 백업은 비활성입니다. `replaceLater`가 있는데 백업 계획이 없으면 최종 validation에서 차단됩니다.

### 최종 확인 modal

최종 확인 modal은 실제 복사 기능이 켜지기 전 사용할 안전장치 구조입니다.

표시 항목:

- 대상 MiSTer alias / host
- 대상 경로 `/media/fat/games`
- 복사 예정 파일 수
- 건너뛸 파일 수
- 충돌 파일 수
- replace 예정 파일 수
- 폴더 생성 예정 수
- 백업 필요 파일 수
- 총 복사 예정 용량
- 원격 여유 공간
- 위험 항목
- 차단 항목
- 확인 문구 `DRY RUN ONLY`

`실제 복사 실행` 버튼은 계속 disabled입니다.

### transfer adapter 상태

`RomTransferService`는 guard와 disabled 결과만 반환합니다.

- `prepareTransfer()`는 plan validation, session 여부, host key 신뢰 여부, 백업 계획 여부를 확인합니다.
- `executeTransfer()`는 항상 `ROM_TRANSFER_DISABLED`를 반환합니다.
- SFTP write stream, 원격 mkdir, rename, unlink, overwrite 구현은 없습니다.
- preload에도 write IPC를 노출하지 않습니다.

### 계획 저장/불러오기

ROM 계획은 appData 또는 브라우저 fallback 저장소에 JSON으로 저장할 수 있습니다.

저장 구조:

- `SavedRomPlan`
- `SavedRomPlanMetadata`
- schemaVersion: 1
- dryRun: true
- readOnly: true

기본 저장/내보내기에서는 로컬 전체 경로를 숨깁니다. 사용자가 명시적으로 선택한 경우에만 로컬 전체 경로를 포함할 수 있습니다. password, privateKey, passphrase, token, raw credential, raw command는 저장하지 않습니다.

### 계속 차단된 위험 기능

- 원격 ROM 실제 복사
- 원격 ROM overwrite
- 원격 ROM rename/delete
- 원격 폴더 생성
- MiSTer.ini 원격 업로드/덮어쓰기
- 스크립트 실행
- reboot/shutdown/hostname 변경
- SD 카드 포맷/플래싱
- renderer raw command IPC

### 다음 단계 제안

1. 실제 MiSTer와 큰 ROM 세트에서 dry-run 계획을 검증합니다.
2. folder creation plan과 backup plan의 UX를 실제 사용자 흐름으로 다듬습니다.
3. 실제 복사 adapter는 백업, 충돌 해결, 재시도, rollback, 중단 복구 설계를 완료한 뒤 별도 단계에서 검토합니다.
## 9차 작업: ROM dry-run 검증 UX 고도화

9차 작업은 실제 ROM 복사를 열기 전, 큰 ROM 세트와 실제 MiSTer를 기준으로 dry-run 계획을 더 안전하게 검증하는 단계입니다. 원격 쓰기, 폴더 생성, overwrite, rename, delete, upload는 여전히 구현하지 않았습니다.

### 대량 ROM 스캔 진행률과 취소 정책

- 로컬 ROM 파일/폴더 선택은 metadata 읽기만 수행합니다.
- 폴더 스캔은 기본 1단계만 수행하고, 재귀 스캔은 사용자가 직접 opt-in 해야 합니다.
- 500개 이상은 경고, 2000개 이상은 강한 경고, 10000개 이상은 명시적 허용 없이는 차단 대상으로 표시합니다.
- 스캔 취소 요청은 UI와 작업 로그에 남기며, 기본 정책은 부분 결과 유지입니다.
- hash 계산은 수동 버튼으로만 수행합니다. 대량 hash 자동 계산은 계속 금지합니다.

### 플랫폼 추천 매핑 확장

확장자 기반 추천 범위를 Atari, Lynx, ColecoVision, MSX, ZX Spectrum, C64, Amiga, Atari ST, X68000/PC-98 후보까지 넓혔습니다.

자동 확정 금지 확장자는 계속 수동 선택이 필요합니다.

- `.zip`, `.7z`
- `.cue`, `.bin`, `.chd`, `.iso`
- `.vhd`
- `.dsk`
- `.rom`, `.mx1`, `.mx2`
- `.adf`, `.hdf`
- `.xdf`, `.dim`, `.hdi`

원격 games 폴더와 이름이 맞더라도 위 확장자는 자동 확정하지 않습니다. 사용자의 manual override가 항상 우선합니다.

### 실제 MiSTer ROM dry-run 검증 절차

Game Management 화면에 ROM dry-run 검증 패널을 추가했습니다. 검증 단계는 다음 순서로 표시됩니다.

1. 기본 MiSTer 프로필 확인
2. session-only 인증 확인
3. SSH host key 신뢰 확인
4. 원격 `/media/fat/games` snapshot
5. 원격 저장공간 조회
6. 로컬 ROM 후보 스캔
7. 플랫폼 추천
8. 대상 폴더 매칭
9. 원격 대상 파일 metadata 비교
10. 충돌 정책 적용
11. 백업 계획 dry-run
12. 최종 복사 계획 dry-run
13. 계획 저장/내보내기 준비

세션 인증이 없거나 host key가 신뢰되지 않았거나 mismatch 상태이면 원격 단계는 차단됩니다. 로컬 단계와 계획 검토는 가능한 범위에서 계속 표시됩니다.

### 복사 계획 UX 개선

복사 계획 화면은 다음 summary를 상단에 표시합니다.

- 총 파일 수
- 복사 예정
- skip
- replace 예정
- rename 예정
- 폴더 생성 예정
- block
- 총 용량
- 복사 예정 용량
- 원격 여유 공간

필터는 전체, 복사 가능, 충돌, 수동 선택 필요, 차단, 대상 폴더 없음, 미지원 확장자, replace 예정 항목을 지원합니다. 정렬은 이름, 크기, 플랫폼, action, conflict 기준을 지원합니다.

### transfer adapter 설계와 rollback 한계

`romTransferDesign.ts`에 미래 실제 복사 adapter의 설계 단계만 정리했습니다.

- prepare
- optional backup
- optional mkdir
- upload temp file
- verify size/hash
- finalize rename
- cleanup temp
- record log

실패 시나리오는 네트워크 끊김, 인증 만료, 저장공간 부족, 원격 파일 존재, upload 중단, 검증 실패, temp cleanup 실패로 분리했습니다.

rollback 한계도 UI와 README에 명시했습니다.

- 원격에 이미 쓰인 파일은 완전 자동 rollback이 어려울 수 있습니다.
- overwrite 전 백업이 없으면 복구할 수 없습니다.
- 네트워크 중단 시 temp 파일이 남을 수 있습니다.
- 원격 폴더 생성은 경로 검증과 사용자 확인 없이 실행하면 안 됩니다.

### 실제 복사가 계속 disabled인 이유

실제 ROM 복사는 다음 조건이 확정되기 전까지 열지 않습니다.

- 백업 정책
- 임시 파일명 정책
- size/hash 검증 정책
- retry 정책
- 사용자 최종 확인 문구
- 작업 중단 UX

`RomTransferService.executeTransfer()`는 계속 `ROM_TRANSFER_DISABLED`를 반환합니다. preload/main에도 upload, mkdir, rename, delete, overwrite IPC를 추가하지 않았습니다.

### 계속 차단된 위험 기능

- 원격 ROM 실제 복사/upload
- 원격 ROM overwrite
- 원격 ROM rename/delete
- 원격 폴더 생성
- MiSTer.ini 원격 업로드/덮어쓰기
- 스크립트 실행
- reboot/shutdown/hostname 변경
- SD 카드 포맷/플래싱
- renderer raw command IPC

### 다음 단계 제안

1. 실제 MiSTer와 대량 ROM 세트로 dry-run 검증 UI를 수동 점검합니다.
2. backup/temp/hash/retry/cancel 정책을 실제 작업 절차로 확정합니다.
3. 실제 전송 adapter는 별도 단계에서 feature flag, 다중 확인, rollback 제한 안내와 함께 검토합니다.

## 10차 작업: ROM transfer 안전 잠금과 시뮬레이션

10차 작업은 실제 ROM 전송을 열기 전 마지막 안전 구조를 고정하는 단계입니다. 원격 upload, mkdir, rename, delete, overwrite, reboot, 스크립트 실행, SD 포맷/플래싱은 계속 구현하지 않았습니다.

### 실제 MiSTer dry-run 검증 기록

Game Management 화면에 “실제 장치 dry-run 검증 기록” 섹션을 추가했습니다. 실제 MiSTer와 실제 ROM 세트로 dry-run을 돌린 뒤 다음 정보를 credential 없이 저장하고 검토할 수 있습니다.

- 대상 프로필과 host key trust 상태
- ROM 후보 수, 총 용량, 플랫폼 해결 수
- 충돌/차단/대상 폴더 없음 개수
- 저장공간 dry-run 상태
- 사용자 메모와 검증 체크리스트
- sanitized summary

기본값으로 local full path는 숨기며, password, privateKey, passphrase, token, raw credential, raw command는 저장하지 않습니다.

### backup/temp/hash/retry/cancel 정책

실제 전송 adapter 구현 전에 다음 정책을 코드와 UI에 고정했습니다.

- `replaceLater` 항목은 백업 계획이 없으면 transfer preflight에서 차단합니다.
- 미래 실제 전송은 최종 파일명으로 바로 쓰지 않고 `.__hello-mister-uploading` 임시 suffix를 사용한 뒤 size/hash 검증 후 finalize rename 해야 합니다.
- 기본 검증은 file size이며, SHA-256은 사용자가 명시적으로 선택한 경우에만 수행합니다.
- `NETWORK_TIMEOUT`은 제한적 재시도 후보지만 `AUTH_FAILED`, `HOST_KEY_MISMATCH`, 저장공간 부족, verify 실패는 자동 재시도하지 않습니다.
- 취소는 이번 단계에서 시뮬레이션만 지원합니다. 실제 업로드 중 취소 시 temp 파일 cleanup은 별도 정책이 필요합니다.
- overwrite 전 백업이 없으면 rollback이 불가능할 수 있고, 네트워크 중단 시 temp 파일이 남을 수 있습니다.

### feature flag / kill switch

`RomTransferFeatureFlagService`를 추가했습니다. 기본값은 모두 비활성입니다.

- `transferEnabled: false`
- `uploadEnabled: false`
- `mkdirEnabled: false`
- `overwriteEnabled: false`
- `deleteEnabled: false`
- `renameEnabled: false`
- `romTransferKillSwitch: true`

feature flag가 켜져도 kill switch가 켜져 있으면 실제 전송은 불가능합니다. preload/main에도 write IPC를 추가하지 않았습니다.

### simulated transfer runner

`RomSimulatedTransferService`는 ROM 계획을 기준으로 진행률, 취소, 실패 상태만 가짜로 생성합니다.

- 원격 SFTP를 호출하지 않습니다.
- 로컬 파일을 수정하지 않습니다.
- mkdir/rename/delete/upload/overwrite를 수행하지 않습니다.
- 작업 로그에는 “시뮬레이션”, “원격 파일 변경 없음”, “실제 복사 아님”으로 기록됩니다.

실패 시나리오는 network timeout, verify failed, storage changed, user cancel을 UI에서 선택할 수 있게 설계했습니다.

### preflight guard 조건

실제 전송 전 preflight는 다음 항목을 검사합니다.

- 계획 존재와 schema version
- target profile
- session credential
- host key trusted 및 mismatch 없음
- 저장공간 dry-run 통과
- 차단 항목 없음
- 사용자 결정 필요 항목 없음
- replaceLater 항목의 backup plan
- targetFolderMissing 처리 여부
- ambiguous/dangerous extension 수동 처리
- 최종 확인 문구
- feature flag와 kill switch

이번 단계에서 `canExecute`는 항상 `false`입니다. `RomTransferService.executeTransfer()`는 계속 `ROM_TRANSFER_DISABLED` 또는 `ROM_TRANSFER_LOCKED` 상태만 반환합니다.

### 실제 ROM 복사가 계속 disabled인 이유

실제 ROM 전송을 열려면 다음을 추가 검증해야 합니다.

1. 백업 다운로드 방식과 실패 처리
2. temp filename 충돌 방지
3. size/hash verify 정책
4. retry/backoff 정책
5. cancel 후 temp cleanup UX
6. 부분 전송과 rollback 한계 안내
7. 사용자 최종 확인과 감사 로그

### 계속 차단된 위험 기능

- 원격 ROM 실제 복사/upload
- 원격 mkdir/rename/delete/overwrite
- 원격 파일 수정
- MiSTer.ini 원격 업로드/덮어쓰기
- 스크립트 실행
- reboot/shutdown/hostname 변경
- SD 카드 포맷/플래싱
- renderer raw command IPC

### 다음 단계 제안

1. 실제 MiSTer와 대량 ROM 세트로 dry-run 기록을 여러 번 저장해 패턴을 검토합니다.
2. backup/temp/hash/retry/cancel 정책을 사용자 문구와 함께 최종 확정합니다.
3. 실제 transfer adapter는 별도 milestone에서 feature flag, kill switch 해제 절차, rollback 제한 고지, 감사 로그를 모두 갖춘 뒤 검토합니다.

## 11차 작업: ROM transfer readiness 리포트

11차 작업은 실제 ROM 전송을 열기 전, dry-run 검증 결과를 사람이 검토할 수 있는 리포트와 체크리스트로 고정하는 단계입니다. 원격 upload, mkdir, rename, delete, overwrite, reboot, 스크립트 실행, SD 포맷/플래싱은 계속 구현하지 않았습니다.

### dry-run 검증 기록 고도화

실제 MiSTer dry-run 검증 기록에 상태 등급, 필터, 정렬, 비교 기능을 추가했습니다.

- 등급: 통과, 부분 통과, 차단됨, 재검증 필요, 실제 전송 검토 불가
- 필터: 통과, 부분 통과, 차단됨, host key 문제, 저장공간 문제, 플랫폼 수동 선택 필요, 충돌 있음
- 정렬: 날짜, 파일 수, 총 용량, 충돌 수, 차단 수
- 비교: ROM 후보 수, 충돌 수, 차단 수, 총 용량, 저장공간 상태, 대상 프로필 변화

검증 기록별 사용자 메모와 체크리스트도 편집할 수 있습니다. 저장 시 password, privateKey, passphrase, token, raw credential, raw command는 제거됩니다.

### dry-run 검증 리포트 구조

`RomDryRunReportService`는 dry-run 검증 기록을 JSON 또는 Markdown 리포트로 내보냅니다.

리포트에는 다음 항목이 들어갑니다.

- 앱 버전과 생성 시간
- 대상 MiSTer alias/host/profileId
- host key trust status
- ROM 후보 수, 총 용량, 플랫폼 확정/수동 선택 필요 수
- 충돌 수, 차단 수, 대상 폴더 없음 수
- 저장공간 상태
- 백업 계획 요약
- preflight 결과
- rollback 한계
- 실제 전송 기능이 잠겨 있는 이유
- 사용자 확인 체크리스트

`canExecute`는 이번 단계에서도 항상 `false`입니다.

### simulated transfer 리포트 구조

`RomSimulationReportService`는 simulated transfer 기록과 리포트를 관리합니다.

리포트에는 반드시 다음 문구가 포함됩니다.

- “이 리포트는 시뮬레이션 결과입니다.”
- “원격 MiSTer에는 어떤 파일도 쓰지 않았습니다.”
- “실제 ROM 복사가 아닙니다.”

시뮬레이션 기록은 파일 수, 총 용량, 취소 여부, 실패 시나리오, 완료/실패 step 수, `remoteWritesPerformed: false`를 포함합니다.

### backup/temp/hash/retry/cancel/rollback 정책 문구

정책 문구를 `romPolicyMessageService.ts`로 정리했습니다.

- Backup: 덮어쓰기 예정 파일은 백업 계획 없이는 진행할 수 없습니다. 이번 버전에서는 실제 백업도 실행하지 않습니다.
- Temp file: 미래 실제 전송에서는 최종 파일명으로 바로 업로드하지 않고 임시 파일명으로 업로드한 뒤 검증 후 전환합니다.
- Verify: 기본 검증은 파일 크기 기준입니다. SHA-256 검증은 사용자가 직접 선택한 경우에만 수행합니다.
- Retry: 네트워크 timeout은 제한적 재시도 후보입니다. 인증 실패, host key mismatch, 저장공간 부족은 자동 재시도하지 않습니다.
- Cancel: 현재는 시뮬레이션 취소만 지원합니다. 실제 업로드 중 취소하면 임시 파일이 남을 수 있습니다.
- Rollback: 백업 없이 덮어쓴 파일은 복구할 수 없고 자동 rollback은 제한적입니다.

### 실제 transfer adapter 전 체크리스트

`RomTransferReadinessService`는 실제 전송 기능 검토 체크리스트를 관리합니다. 이 체크리스트는 검토용이며 실제 전송 활성화 버튼을 제공하지 않습니다.

필수 항목은 다음을 포함합니다.

- 실제 MiSTer에서 dry-run 검증 기록 3회 이상
- 대량 ROM 세트 dry-run 1회 이상
- host key trusted 상태 확인
- session-only credential 정책 유지 확인
- backup plan 생성 확인
- replaceLater 항목 처리 확인
- targetFolderMissing 항목 처리 확인
- storage dry-run 통과
- dangerous extension 수동 처리 완료
- final confirmation UX 확인
- simulated transfer 성공/취소/실패 시나리오 확인
- rollback 한계 문구 확인
- write IPC 미노출 확인
- raw command IPC 없음 확인
- 테스트 전체 통과

### preflight guard 메시지

preflight blocker를 한국어 안내로 변환하는 formatter를 추가했습니다. UI는 blocker, warning, required action을 분리해서 표시하고, kill switch와 feature flag disabled 상태를 명확히 보여줍니다.

### export sanitize와 full path masking

`exportSanitizer.ts`를 추가해 검증 기록, 리포트, 시뮬레이션 기록, 체크리스트 내보내기의 sanitize 규칙을 공통화했습니다.

항상 제거되는 항목:

- password
- privateKey
- passphrase
- token
- secret
- credential
- rawCommand
- privateKeyPath

로컬 전체 경로는 기본적으로 파일명 중심으로 마스킹합니다. full path 포함은 사용자가 명시적으로 선택했을 때만 허용하며, 리포트 상단에 경고 문구를 포함합니다.

### 실제 ROM 복사가 계속 disabled인 이유

아직 다음 항목이 실제 장치에서 충분히 검증되지 않았기 때문입니다.

1. dry-run 검증 기록 축적
2. 대량 ROM 세트 검증
3. 백업 실패 처리
4. temp 파일 cleanup 정책
5. hash/size verify 정책
6. 취소와 부분 전송 복구 UX
7. rollback 한계 고지
8. write IPC와 실제 SFTP adapter의 별도 보안 검토

### 계속 차단된 위험 기능

- 원격 ROM 실제 복사/upload
- 원격 mkdir/rename/delete/overwrite
- 원격 파일 수정
- MiSTer.ini 원격 업로드/덮어쓰기
- 스크립트 실행
- reboot/shutdown/hostname 변경
- SD 카드 포맷/플래싱
- renderer raw command IPC

### 다음 단계 제안

1. 실제 장치 dry-run 리포트를 여러 개 생성해 비교 결과를 확인합니다.
2. 시뮬레이션 성공/취소/실패 리포트를 실제 운영 문구로 다듬습니다.
3. 실제 transfer adapter는 write IPC 설계, SFTP temp upload, verify, rollback 한계를 별도 milestone에서 검토합니다.

## 12차: Windows Electron 앱 검토 준비

이번 단계의 목표는 브라우저 smoke가 아니라 실제 Electron 앱 창 기준으로 Hello Mister v2.0을 검토할 수 있게 만드는 것입니다. 기존 카드 스티커 앱 폴더는 수정하지 않고, `hello-mister-v2` 프로젝트 내부에서만 변경합니다.

### 실제 Electron 앱 실행 방법

- 개발 서버만 확인: `npm.cmd run dev`
- 실제 Electron 앱 창 검토: `npm.cmd run desktop:review`
- 검토용 폴더 생성: `npm.cmd run package:review`
- 검토용 산출물 위치: `release/hello-mister-v2-review`

`package:review`는 installer가 아니라 검토용 폴더를 만듭니다. 빌드된 Vite assets, Electron main/preload 파일, README, 실행 안내 배치 파일을 포함하며, 사용자 시스템에 자동 설치하지 않습니다.

### Browser fallback과 Electron 앱 차이

Electron 앱 창에서는 preload IPC를 통해 appData 상태, Windows 파일 dialog, 로컬 파일 metadata, 저장 dialog를 사용할 수 있습니다. 브라우저 fallback에서는 이 기능들이 제한되며 UI에 “브라우저 fallback에서는 제한됩니다”라고 표시합니다.

### appData 저장 위치와 저장 파일

설정 페이지의 “앱 데이터 저장소” 섹션에서 장치 프로필, 신뢰한 SSH 호스트, SSH host key 변경 이력, MiSTer 프로필 summary cache, 작업 로그, 저장된 ROM dry-run 계획, ROM dry-run 검증 기록, 전송 시뮬레이션 기록, 검토 체크리스트 상태를 읽기 전용으로 확인합니다.

각 항목은 존재 여부, 파일 크기, 마지막 수정 시간, secret 계열 키 감지 상태를 표시합니다. 데이터 삭제 기능은 제공하지 않습니다.

### 파일 dialog 검토 항목

Electron 앱 창에서 ROM 파일 선택, ROM 폴더 선택, 로컬 Mr. Fusion 이미지 선택, INI 파일 내보내기, ROM 계획 JSON 내보내기, 백업 계획 JSON 내보내기, dry-run 리포트 JSON/Markdown 내보내기, simulated transfer 리포트 JSON/Markdown 내보내기, 진단 패키지 내보내기를 검토합니다.

취소와 실패는 한국어 메시지로 표시하고, 성공 시 저장 위치를 표시합니다.

### 실제 MiSTer read-only 검토 체크리스트

백업/진단 페이지에 실제 장치 검토용 체크리스트를 추가했습니다. 같은 네트워크 여부, 자동검색 후보, session-only 인증, host key 신뢰, `/media/fat` 구조, MiSTer.ini 미리보기, games/Scripts 목록, read-only 통합 테스트, 진단 패키지 내보내기, 작업 로그 기록, 인증 정보 미저장, 원격 쓰기 잠금 확인을 포함합니다.

### ROM dry-run 실사용 검토 체크리스트

게임 관리 페이지에 ROM dry-run 검토 체크리스트를 추가했습니다. 실제 ROM 폴더 선택, 대량 스캔 경고, 재귀 스캔 opt-in, 플랫폼 추천, 위험 확장자 자동 확정 금지, 원격 games snapshot, 충돌 확인, 저장공간 dry-run, 백업 계획, 최종 확인 modal, simulated transfer 시나리오, dry-run 리포트 내보내기, 실제 복사 버튼 잠금 확인을 기록합니다.

### Windows 패키징 검토

이번 단계에서는 electron-builder installer/portable 의존성을 추가하지 않았습니다. 대신 `package:review`로 검토용 폴더를 만들고, 실제 installer/portable 패키징은 다음 단계에서 별도 검토합니다. 산출물 이름과 표시명은 Hello Mister v2.0 기준을 사용합니다.

### 계속 disabled인 위험 기능

- 실제 ROM copy/upload
- 원격 mkdir/rename/delete/overwrite
- 원격 파일 수정
- reboot/shutdown/hostname 변경
- MiSTer.ini 원격 적용
- 스크립트 실행
- SD 포맷/플래싱
- raw command IPC

### 다음 단계 제안

1. 실제 Windows Electron 앱 창에서 appData, 파일 dialog, 진단 패키지 저장을 수동 검토합니다.
2. 실제 MiSTer 장치로 read-only 체크리스트를 1회 이상 완료합니다.
3. 실제 ROM 세트로 dry-run 리포트와 simulated transfer 리포트를 생성합니다.
4. installer/portable 패키징이 필요하면 electron-builder 도입 여부를 별도 milestone에서 검토합니다.

## Hotfix: Electron review 흰 화면 수정

Electron review 앱에서 DOM에 `<div id="root"></div>`만 남고 React UI가 렌더링되지 않는 문제가 있었습니다.

원인은 Vite build 결과의 `dist/index.html`이 `file://` 환경에서 `/assets/index-*.js`, `/assets/index-*.css`처럼 루트 절대경로를 참조한 것입니다. Electron `loadFile()`은 `dist/index.html`을 정상 로드했지만, `/assets/...`는 Windows 드라이브 루트 기준 경로가 되어 `net::ERR_FILE_NOT_FOUND`가 발생했습니다.

수정 내용:

- `vite.config.ts`에 `base: './'`를 설정했습니다.
- build 후 `dist/index.html`은 `./assets/index-*.js`, `./assets/index-*.css` 상대경로를 사용합니다.
- review package는 `dist/index.html`과 `dist/assets/*`를 함께 복사합니다.
- renderer bootstrap 실패 시 빈 화면 대신 “화면을 불러오지 못했습니다.” 오류 화면을 표시합니다.
- `npm.cmd run smoke:electron`으로 Electron DOM 렌더링 smoke test를 실행할 수 있습니다.

검토 명령:

1. `npm.cmd run build`
2. `Get-Content dist\index.html`에서 asset 경로가 `./assets/...`인지 확인
3. `npm.cmd run package:review`
4. `npm.cmd run smoke:electron`
5. 필요 시 `npm.cmd run desktop:review`로 실제 앱 창 확인
## 13차: 데스크톱 검토 경험 단순화

13차 목표는 새 기능 추가가 아니라, 이미 구현된 읽기 전용 기능과 ROM 미리 검사 기능을 처음 열었을 때 덜 복잡하게 보이도록 정리하는 것입니다. 기능과 데이터 구조는 삭제하지 않고, 상세 정책/리포트/디버그성 정보는 고급 보기 또는 접힌 영역으로 이동했습니다.

### 간단 보기 / 고급 보기

- 기본값은 `간단 보기`입니다.
- 좌측 사이드바와 설정 화면에서 `간단 보기 / 고급 보기`를 전환할 수 있습니다.
- 간단 보기에서는 현재 상태, 다음 행동, 필수 버튼, 잠금 상태 요약만 먼저 보여줍니다.
- 고급 보기에서는 기존 상세 정보, 리포트 내보내기 옵션, 정책 전문, appData 파일별 상태, host key 이력, 기술 로그를 그대로 확인할 수 있습니다.

### 화면별 정리 내용

- 홈: 검토 대시보드, 빠른 시작 3개, 최근 작업 3개, 실제 전송 잠금 요약을 먼저 보여줍니다.
- MiSTer 연결: `장치 찾기 → 장치 저장 → 세션 인증 → SSH 장치 신뢰 키 확인 → 읽기 전용 검증` 흐름을 상단에 표시합니다. 신뢰한 SSH 호스트 상세 목록은 간단 보기에서 숨기고 고급 보기에서 확인합니다.
- 게임 관리: `ROM 선택 → 미리 검사 → 충돌/용량 확인 → 복사 계획 확인 → 리포트/시뮬레이션` 흐름을 상단에 표시합니다. 정책, 리포트 기록, readiness checklist, rollback 전문은 고급 보기에서 확인합니다. 간단 보기의 계획 테이블은 처음 10개 행만 표시합니다.
- 백업/진단: 실제 MiSTer read-only 검토와 진단 패키지 생성 흐름을 우선 보여주고, 백업 skeleton, 전체 작업 로그, raw 진단 미리보기는 고급 보기에서 확인합니다.
- 설정: 실행 환경, 앱 데이터 저장 위치, 보기 모드, 실제 전송 잠금 상태를 먼저 보여줍니다. appData 파일별 크기/수정 시간과 파일 dialog 세부 검토 목록은 고급 보기로 이동했습니다.

### 용어 정리

- dry-run → 미리 검사
- simulated transfer → 복사 시뮬레이션
- preflight guard → 실행 전 안전 검사
- kill switch → 전송 전체 잠금
- feature flag → 기능 잠금 설정
- host key → SSH 장치 신뢰 키
- fingerprint → 신뢰 키 지문
- appData → 앱 데이터 저장 위치

### 계속 잠긴 기능

이번 단계에서도 실제 ROM copy/upload, 원격 mkdir/rename/delete/overwrite, 원격 파일 수정, reboot/shutdown, MiSTer.ini 원격 적용, 스크립트 실행, SD 포맷/플래싱, raw command IPC는 구현하지 않았습니다.

### 검토 방법

1. `npm.cmd run desktop:review`로 실제 Electron 앱 창을 엽니다.
2. 간단 보기에서 홈, MiSTer 연결, 게임 관리, 백업/진단, 설정 화면의 기본 흐름을 확인합니다.
3. 고급 보기로 전환해 기존 정책/리포트/로그가 삭제되지 않고 접근 가능한지 확인합니다.
4. `npm.cmd run package:review`와 `npm.cmd run smoke:electron`으로 검토용 패키지와 Electron 렌더링을 확인합니다.
## 14차: 기본/고급/개발자 모드와 스티커 제작 허브

14차 목표는 13차의 `간단 보기 / 고급 보기`를 더 분명한 3단계 구조로 바꾸고, 기본 모드에 v1.0 스티커 제작 흐름을 다시 배치하는 것입니다. 기존 `zaparoo-nfc-card-stickers` 폴더는 읽기 전용으로만 분석했고, v2 앱이 패키징 후 독립적으로 동작하도록 v1 폴더를 runtime dependency로 참조하지 않습니다.

### 앱 모드

- `기본 모드`: 홈, 스티커 제작, MiSTer 연결, 게임 관리, 백업/진단, 설정만 우선 노출합니다.
- `고급 모드`: SD 카드 관리, INI 설정, 스크립트 관리, 컨트롤러 관리, 동기화 같은 관리 메뉴를 추가로 보여줍니다.
- `개발자 모드`: appData 파일별 상태, 파일 dialog 검토, 작업 로그, 리포트/정책/rollback/IPC 검토성 정보를 보여줍니다.

기본값은 `기본 모드`입니다. 모드는 좌측 사이드바와 설정 화면에서 바꿀 수 있습니다.

### 스티커 제작 허브

기본 모드에 `스티커 제작` 메뉴를 추가했습니다. 현재 허브는 v1 기능을 v2 내부로 가져오기 위한 독립 진입점입니다.

포함된 v1 기능 영역:

- 카드/스티커 편집
- 이미지 관리
- 템플릿 관리
- 카드 앨범
- 시트/출력

이번 단계에서는 v1 폴더의 코드를 직접 실행하거나 v1 데이터 파일을 수정하지 않습니다. v1에서 확인한 주요 구조는 `CardEditorPage`, `AssetLoadingPage`, `CardAlbumPage`, `TemplateManagementPage`, `PrintSheetPreview`, `CardPreview`, `TemplateThumbnail`, asset/template/card persistence, PNG/PDF/sheet export 계열입니다.

### 개발자 모드로 이동한 정보

다음 정보는 기본 모드에서 숨기고 개발자 모드에서 확인하도록 정리했습니다.

- appData 파일별 크기/수정 시간/sanitize 상태
- 파일 dialog 검토 항목
- 작업 로그
- 전송 안전 정책, rollback 한계, readiness checklist
- host key 이력과 리포트성 정보
- IPC/테스트/디버그성 상태

### 계속 잠긴 기능

실제 ROM copy/upload, 원격 mkdir/rename/delete/overwrite, 원격 파일 수정, reboot/shutdown, MiSTer.ini 원격 적용, 스크립트 실행, SD 포맷/플래싱, raw command IPC는 계속 구현하지 않았습니다.

### 검토 방법

1. 기본 모드에서 홈과 스티커 제작 허브가 먼저 보이는지 확인합니다.
2. 고급 모드에서 SD/INI/스크립트/컨트롤러/동기화 메뉴가 나타나는지 확인합니다.
3. 개발자 모드에서 appData, 로그, 리포트, 정책 상세가 나타나는지 확인합니다.
4. 실제 전송 버튼과 원격 쓰기 IPC가 계속 잠겨 있는지 확인합니다.

## 15차: 스티커 제작 v1 기능 MVP 통합

이번 단계의 목표는 기존 `zaparoo-nfc-card-stickers` 폴더를 수정하거나 런타임에 참조하지 않고, Hello Mister v2.0 안에 스티커 제작 흐름을 독립 기능으로 복원하는 것입니다. 기존 v1 앱은 읽기 전용으로만 분석했고, v2 패키징 후에도 동작하도록 필요한 구조를 v2 내부에 새로 구현했습니다.

### v1 스티커 앱 분석 요약

- 주요 페이지: `AssetLoadingPage`, `TemplateManagementPage`, `CardEditorPage`, `CardAlbumPage`, `ExportPreviewPage`
- 주요 렌더링 구조: `CardPreview`, `EditableCardTemplatePreview`, `TemplateThumbnail`, `PrintSheetPreview`, `sheetDomExport`
- 주요 저장/서비스 영역: 이미지 소스/캐시, 템플릿 저장소, 카드 저장소, 시트 출력, PNG/PDF export, print flow
- 주요 dependency: `konva`, `react-konva`, `pdf-lib`, `jszip`, `zustand`
- v2 MVP는 새 dependency 없이 HTML/CSS 미리보기와 appData JSON 저장소로 시작합니다. v1 고급 캔버스 편집과 고품질 PDF/PNG 출력은 후속 단계에서 필요한 코드만 선별 이식합니다.

### v2 스티커 제작 라우트

- `/stickers`: 스티커 제작 허브
- `/stickers/images`: 이미지 관리
- `/stickers/templates`: 템플릿 관리
- `/stickers/editor`: 카드/스티커 편집
- `/stickers/album`: 카드 앨범
- `/stickers/output`: 시트/출력

기본 모드에서도 위 기능은 모두 보입니다. 고급/개발자 모드에서도 동일하게 접근할 수 있습니다.

### 이미지 관리 구현 내용

- 로컬 이미지 파일 선택
- 로컬 이미지 폴더 선택
- 기본 1단계 스캔, 재귀 스캔은 사용자가 직접 선택
- 지원 확장자: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`
- 파일명/폴더명 기반 이미지 타입 추천: 커버, 타이틀, 로고, 마키, 스크린샷, 배경, 템플릿 자산, 미분류
- 게임명 후보 정규화
- grid/list 보기, 썸네일 크기, 검색, 확장자 필터, 타입 필터
- JSON 내보내기 시 기본적으로 전체 로컬 경로를 숨깁니다.

### 템플릿 관리 구현 내용

기본 제공 템플릿:

1. 기본 카드형
2. 네오지오 스타일
3. CD 커버 스타일
4. 미니멀 라벨
5. 아케이드 라벨
6. TapTo/NFC 카드형

기능:

- 템플릿 목록/미리보기
- 템플릿 선택
- 템플릿 복제
- 이름 변경
- 즐겨찾기
- 기본 템플릿 지정
- 기본 템플릿 삭제 금지
- 사용자 템플릿 삭제 허용
- JSON 내보내기와 붙여넣기 기반 JSON 가져오기

### 카드/스티커 편집 구현 내용

- 새 카드 만들기
- 템플릿 선택
- 이미지 선택
- 제목, 부제, 플랫폼, 게임명 입력
- 실행 경로/NFC 경로 후보 입력
- HTML/CSS 기반 카드 미리보기
- appData에 카드 저장
- 카드 JSON 내보내기
- 저장된 카드는 카드 앨범에서 바로 확인

현재 단계에서는 실제 NFC 쓰기나 원격 MiSTer 작업을 하지 않습니다.

### 카드 앨범 구현 내용

- 저장된 카드 목록
- grid/list 보기
- 검색
- 플랫폼 필터
- 태그 필터
- 상세 보기
- 편집 화면으로 이동
- 카드 복제
- 로컬 앨범에서 삭제
- 카드 JSON 내보내기
- 선택 카드를 시트/출력으로 전달

삭제는 v2 로컬 appData 카드 데이터에만 적용되며 원격 MiSTer, ROM 파일, 기존 v1 폴더에는 영향을 주지 않습니다.

### 시트/출력 구현 내용

- 카드 앨범에서 카드 선택
- A4 / Letter 용지 프리셋
- NFC 카드 / 스티커 라벨 / 사용자 지정 카드 크기 구조
- 행/열, 간격, 여백 설정
- 같은 시트 배치 계산을 사용하는 화면 미리보기
- SVG 내보내기
- HTML 인쇄 미리보기

고해상도 PNG/PDF 출력은 v1의 `sheetDomExport`, PNG/PDF export 흐름을 참고해 후속 단계에서 보강합니다.

### appData 저장 파일

스티커 기능은 v2 appData 아래에 다음 JSON 파일을 사용합니다.

- `stickers/sticker-image-library.json`
- `stickers/sticker-templates.json`
- `stickers/sticker-cards.json`
- `stickers/sticker-sheets.json`

저장소와 내보내기는 secret 계열 값과 raw command를 저장하지 않도록 sanitize합니다. 앱 내부 동작에는 로컬 이미지 경로가 필요할 수 있지만, 기본 export에서는 파일명 중심으로 마스킹합니다. 전체 경로 포함 export는 개발자 모드 후속 옵션으로만 다룹니다.

### 런타임 독립성

v2 스티커 기능은 기존 v1 폴더를 런타임 dependency로 참조하지 않습니다. 패키징된 review build에서도 v2 내부 코드와 appData 저장소만 사용합니다.

### 아직 남은 작업

- v1 수준의 정밀 캔버스 편집
- 템플릿 레이어/슬롯 고급 편집
- 이미지 crop/transform UI
- 썸네일 캐시
- 고해상도 PNG/PDF 출력
- 실제 카드 앞/뒤면 모델
- 기존 v1 데이터 가져오기 마법사

### 계속 차단된 위험 기능

실제 ROM copy/upload, 원격 mkdir/rename/delete/overwrite/upload, 원격 파일 수정, reboot/shutdown, MiSTer.ini 원격 적용, 스크립트 실행, SD 포맷/플래싱, raw command IPC는 계속 구현하지 않았습니다.

### 검증 방법

1. `npx tsc --noEmit`
2. `npm.cmd run lint`
3. `npm.cmd run build`
4. `npm.cmd run test`
5. `npm.cmd run package:review`
6. `npm.cmd run smoke:electron`

## 방향 수정: v1 스티커 앱을 기준으로 한 Hello Mister v2.0

이번 단계부터 Hello Mister v2.0은 새로 만든 스티커 MVP가 아니라, 기존 v1.0 스티커 앱에 MiSTer 관리 기능을 더하는 업데이트로 정리한다.

### v1 스티커 앱 복구 방식

- 기존 v1 폴더 `<v1 참조 폴더(zaparoo-nfc-card-stickers)>`는 읽기 전용 참고 자료로만 사용한다.
- 패키징 후에도 v1 폴더에 의존하지 않도록 v1 스티커 소스와 스타일을 v2 내부 `src/features/sticker-v1`로 복사해 사용한다.
- `/stickers`, `/stickers/images`, `/stickers/templates`, `/stickers/editor`, `/stickers/album`, `/stickers/output`, `/stickers/template-editor` 라우트는 v1 원본 페이지를 감싸는 wrapper로 연결한다.
- v2에서 임시로 만든 스티커 MVP 화면은 v1 실제 기능 wrapper로 대체했다.
- v1 호환 desktop bridge는 `window.zaparooDesktop`으로 v2 Electron preload/main 내부에 제공되며, v1 폴더를 runtime path로 참조하지 않는다.

### v1에서 가져온 핵심 기능

- 카드/스티커 편집 화면
- 이미지 관리 화면
- 템플릿 관리 및 템플릿 편집 화면
- 카드 앨범 화면
- 시트/출력 화면
- v1 전역 스타일 및 필요한 sticker feature 내부 모듈
- v1 스토어 hydration 흐름

일부 출력/파일 작업은 v2 Electron bridge에 맞게 연결했다. 원격 쓰기, ROM 전송, SD 플래싱 같은 위험 기능은 계속 잠겨 있다.

### MiSTer 연결 방식 변경

기본 흐름에서 MiSTer 자동검색은 제거하고, IP 직접 입력 방식으로 변경했다.

- IP 직접 입력
- 별칭 입력
- 사용자명 기본값: `root`
- 비밀번호 기본값: `1`
- 자동 연결 기본값: 켜짐
- 저장 후 백그라운드 read-only 연결 시도
- 기본 모드에서는 세션 인증 패널을 노출하지 않음

자동검색 기능은 삭제하지 않고 개발자 모드의 보관된 고급 도구로 이동했다.

### 비밀번호 저장 정책

- 기본 비밀번호 `1`은 MiSTer 기본값으로만 사용한다.
- 프로필에는 `passwordMode`만 저장하고 실제 `password`, `privateKey`, `passphrase`, `token`은 저장하지 않는다.
- 사용자가 기본값이 아닌 비밀번호를 쓰는 경우 앱 실행 중 메모리에서만 사용한다.
- 안전한 장기 저장이 필요하면 추후 Windows Credential Manager 같은 전용 저장소를 검토한다.

### 기본/고급/개발자 모드

- 기본 모드의 중심 기능은 스티커 제작이다.
- 기본 모드 메뉴: 스티커 제작, MiSTer 연결, MiSTer 게임 롬 관리, 설정
- 고급 모드에는 SD 카드, INI, 스크립트, 컨트롤러, 백업/진단, 동기화 같은 관리 기능을 노출한다.
- 개발자 모드에는 자동검색, appData, IPC, 로그, 리포트, 정책 상세 정보를 둔다.

### 계속 차단된 기능

다음 기능은 구현하거나 활성화하지 않는다.

- 실제 ROM copy/upload
- 원격 mkdir/rename/delete/overwrite/upload
- 원격 파일 수정
- reboot/shutdown
- MiSTer.ini 원격 적용
- 스크립트 실행
- SD 포맷/플래싱
- raw command IPC

### 검증

이번 방향 수정 후 다음 검증을 기준으로 한다.

1. `npx tsc --noEmit`
2. `npm.cmd run lint`
3. `npm.cmd run build`
4. `npm.cmd run test`
5. `npm.cmd run package:review`
6. `npm.cmd run smoke:electron`

## Hotfix: v1 스티커 내부 메뉴와 수동 MiSTer 프로필

### 목표

이번 hotfix는 새 기능 개발이 아니라 회귀 복구다. Hello Mister v2.0은 v1.0 스티커 앱을 다시 만든 앱이 아니라, v1.0 스티커 앱을 기반으로 MiSTer 관리 기능을 추가하는 업데이트다.

### v1 스티커 내부 메뉴 클릭 문제

문제 원인은 v2가 v1 스티커 페이지를 `/stickers/images`, `/stickers/templates`, `/stickers/editor` 같은 개별 wrapper로 따로 mount한 반면, v1 내부 메뉴는 원래 `/assets`, `/mister`, `/templates`, `/editor`, `/album`, `/export` 같은 v1 앱 shell 내부 경로를 사용했다는 점이다.

수정 내용:

- `/stickers/*` 아래에 v1 `App` shell 전체를 mount한다.
- v1 내부 메뉴 링크를 `/stickers/...` 기준으로 맞춘다.
- v2 외부 shell은 `/stickers` 경로에서는 한 발 물러나 v1 shell이 원래 레이아웃과 메뉴를 담당하게 한다.
- `/stickers/images`, `/stickers/mister`, `/stickers/templates`, `/stickers/editor`, `/stickers/album`, `/stickers/output`, `/stickers/template-editor`가 v1 원본 페이지로 열린다.
- Electron smoke test에 v1 내부 메뉴 클릭 검증을 추가했다.

v1 스티커 기능은 새 MVP나 placeholder로 대체하지 않는다. 필요한 코드는 v2 내부 `src/features/sticker-v1`에 복사되어 있으며, 기존 v1 폴더를 runtime dependency로 참조하지 않는다.

### MiSTer 자동 연결 비활성화

사용자가 저장한 MiSTer 프로필이 있어도 앱 시작 시 백그라운드 자동 연결을 하지 않는다.

- `autoConnect` 기본값은 꺼짐이다.
- 기존 저장 프로필에 `autoConnect: true`가 있어도 v2에서는 자동 연결하지 않도록 sanitize한다.
- IP 저장 후에도 자동 연결하지 않는다.
- 사용자가 명시적으로 “연결”를 눌렀을 때만 read-only 연결을 시도한다.
- 기본 사용자명은 `root`, 기본 비밀번호는 `1`이다.
- 기본 비밀번호 `1`은 기본값으로만 사용하며 appData에 secret으로 저장하지 않는다.

### 저장된 MiSTer 삭제

저장된 MiSTer 목록에서 프로필을 삭제할 수 있다.

- 기본 동작은 “프로필만 삭제”이다.
- 선택하면 “프로필과 SSH 신뢰 키도 함께 삭제”할 수 있다.
- 삭제 시 profile store, profile summary cache, session memory를 정리한다.
- 삭제된 프로필이 기본 MiSTer였으면 기본 MiSTer 설정도 해제한다.
- 삭제 작업은 task log에 남기되 password/privateKey/passphrase/token은 기록하지 않는다.

### 계속 차단된 기능

다음 위험 기능은 이번 hotfix에서도 계속 잠겨 있다.

- 실제 ROM copy/upload
- 원격 mkdir/rename/delete/overwrite/upload
- 원격 파일 수정
- reboot/shutdown
- MiSTer.ini 원격 적용
- 스크립트 실행
- SD 포맷/플래싱
- raw command IPC

### 검증 항목

- `npx tsc --noEmit`
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`
- `npm.cmd run package:review`
- `npm.cmd run smoke:electron`

## Hotfix: v2 사이드바 유지와 v1 MiSTer 연결 통합

이번 hotfix는 `/stickers/*` 진입 시 v1 shell이 앱 전체를 소유해 v2 왼쪽 사이드바로 돌아오기 어려웠던 문제를 정리한다. Hello Mister v2.0의 기준은 v1.0 스티커 앱이며, v2는 그 위에 MiSTer 관리 기능을 추가하는 업데이트다.

### 수정한 구조

- v2 `AppLayout`은 `/stickers/*`에서도 항상 유지된다.
- v2 왼쪽 사이드바의 “스티커 제작” 아래에 하위 메뉴를 펼쳐 노출한다.
- 하위 메뉴는 `미스터 게임 리스트`, `템플릿`, `카드편집`, `이미지/에셋`, `카드 앨범`, `출력/시트`, `템플릿 편집`, `NFC 관리`로 구성한다.
- v1 `App`은 전체 앱 shell과 콘텐츠 route를 분리했다.
- v2에서는 v1의 `StickerV1ContentHost`와 `StickerV1Routes`만 콘텐츠 영역에 mount한다.
- v1 전체 shell은 보존하되, v2 route에서는 v2 layout을 가로채지 않는다.

### v1 하위 메뉴 연결

- `/stickers/mister`: v1 MiSTer FPGA / 미스터 게임 리스트 화면
- `/stickers/project-games`: 사용자 메뉴에서는 제거했으며, 기존 링크 호환을 위해 `/stickers/mister`로 이동한다.
- `/stickers/templates`: v1 템플릿 관리
- `/stickers/editor`: v1 카드편집 / 카드 편집기
- `/stickers/images`: v1 이미지/에셋 관리
- `/stickers/album`: v1 카드 앨범
- `/stickers/output`: v1 출력/시트
- `/stickers/template-editor`: v1 템플릿 편집기

기존 `/stickers/cards`는 `/stickers/editor`로 redirect하고, 기존 v1 alias route도 유지한다.

### v1 MiSTer FPGA 연결 통합

v1 MiSTer 화면은 원래 로컬 HTTP bridge(`http://127.0.0.1:37321`)를 우선 사용했다. v2 패키지 앱에서는 이 bridge가 없거나 v2 SSH adapter와 분리되어 있어 연결이 실패할 수 있었다.

이제 v1의 `HttpMiSTerBridgeClient`는 Electron 환경에서 v2 `helloMisterDesktop` read-only SSH IPC를 먼저 사용한다.

- host key 확인은 v2 known-host flow를 사용한다.
- 최초 host key는 사용자가 확인하면 등록한다.
- host key mismatch는 차단한다.
- 연결는 v2 read-only fingerprint를 사용한다.
- `/media/fat`, `/media/fat/games`, `/media/fat/Scripts`, `/media/fat/MiSTer.ini` 상태를 v1 연결 상태로 매핑한다.
- `/media/fat/games` 1단계 폴더 조회는 v2 read-only API를 사용한다.

위험 작업은 계속 막는다.

- NFC 쓰기/읽기/검증은 v2 안전 정책상 잠금 응답을 반환한다.
- 원격 게임 실행은 잠금 응답을 반환한다.
- ROM copy/upload, mkdir, rename, delete, overwrite, reboot, script 실행, SD flash는 구현하지 않는다.

### 자동연결 정책

- 자동검색은 기본 모드에서 보이지 않는다.
- 저장된 MiSTer 프로필은 앱 시작 시 자동 연결하지 않는다.
- IP 저장 후에도 자동 연결하지 않는다.
- `autoConnect`는 기본값과 저장값 모두 `false`로 유지한다.
- 연결은 사용자가 명시적으로 “연결”를 눌렀을 때만 시도한다.
- 기본 username은 `root`, 기본 password 표시는 `1`이다.
- password/privateKey/passphrase/token은 appData에 저장하지 않는다.

### 저장된 MiSTer 삭제

- 저장된 MiSTer 목록에서 프로필 삭제가 가능하다.
- 기본 삭제는 프로필만 삭제한다.
- 사용자가 선택하면 SSH 신뢰 키도 함께 삭제할 수 있다.
- 삭제 시 profile summary cache와 session memory도 정리한다.

### 검증

- `npx tsc --noEmit`
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`
- `npm.cmd run package:review`
- `npm.cmd run smoke:electron`

## 현재 메뉴/연결 구조 정리

이번 정리 후 Hello Mister v2.0은 v1.0 스티커 앱을 기본 기능으로 두고, MiSTer 관리 기능을 그 위에 추가하는 방향을 따른다.

- 홈 메뉴와 동기화 메뉴는 기본 사이드바에서 제거했다.
- 앱 시작 기본 경로는 `/stickers/mister`이며, 스티커 제작 하위 메뉴는 v2 왼쪽 사이드바에 항상 표시된다.
- 스티커 제작 하위 메뉴는 `미스터 게임 리스트`, `템플릿`, `카드편집`, `이미지/에셋`, `카드 앨범`, `출력/시트`, `템플릿 편집`, `NFC 관리`로 정리했다. `프로젝트 게임` 메뉴는 사용자 요청에 따라 제거했고, 기존 `/stickers/project-games` 링크는 미스터 게임 리스트로 이동한다.
- `미스터 라이브러리` 명칭은 사용자 화면에서 `미스터 게임 리스트`로 바꾸고, `라이브러리 동기화`는 `게임 리스트 동기화`로 바꿨다.
- MiSTer 연결은 자동 연결이 아니라 사용자가 `연결`을 눌렀을 때만 읽기 전용 확인을 수행한다.
- 저장된 MiSTer 목록의 기본 액션은 `연결`, `수정`, `삭제`로 줄였다.
- 비밀번호 입력 기본값은 `1`로 유지하되, 저장 시에는 Electron `safeStorage`가 가능한 환경에서만 암호화해 별도 credential 파일에 저장한다. 프로필 JSON에는 평문 비밀번호를 저장하지 않는다.
- 자동검색은 기본 흐름이 아니며, IP 입력 옆의 보조 기능으로만 사용한다.
- 게임 리스트는 카드 제작, 실행 준비, NFC 연결의 기준이고, ROM 관리는 파일 복사/삭제/이동의 기준으로 분리한다.
- 실제 ROM copy/upload, 원격 mkdir/rename/delete/overwrite, SD 포맷/플래싱, reboot/shutdown, raw command IPC는 아직 열지 않았다. 이후 실제 전송을 열 때는 별도 adapter, 진행률, 취소, 검증, 백업/휴지통 정책을 먼저 확정해야 한다.

다음 단계는 실제 MiSTer에 연결한 상태에서 v1 스티커 하위 메뉴와 MiSTer 연결 화면을 수동 검증하고, 그 다음 ROM 관리/INI/Script/Controller 기능을 화면별로 실제화하는 것이다.
## 수동 MiSTer 연결과 ROM 관리 흐름 안정화

이번 단계는 실제 ROM 복사를 열기 전, MiSTer 연결 정보와 복사 전 확인 흐름을 실제 사용 기준으로 정리한 단계입니다.

### safeStorage 비밀번호 저장 정책

- MiSTer 프로필 JSON에는 `password`, `privateKey`, `passphrase`, `token`을 저장하지 않습니다.
- Electron 환경에서 `safeStorage` 암호화를 사용할 수 있을 때만 별도 credential 저장소에 암호문(`cipherText`)으로 저장합니다.
- `safeStorage`를 사용할 수 없는 환경에서는 비밀번호를 저장하지 않고 사용자에게 안내합니다.
- 기본 비밀번호 `1`은 입력창 기본값이며, 저장될 경우에도 평문 JSON이 아니라 safeStorage 암호문으로만 저장됩니다.
- 프로필 삭제 시 해당 프로필의 암호화 비밀번호 항목도 함께 삭제합니다.

### 수동 연결 정책

- 저장 후 자동 연결하지 않습니다.
- 앱 시작 시 자동 연결하지 않습니다.
- 사용자가 저장된 MiSTer의 `연결` 버튼을 누른 경우에만 SSH/SFTP read-only fingerprint를 실행합니다.
- 최초 host key는 간단 확인 후 신뢰 등록하며, host key mismatch는 연결을 차단합니다.
- 연결 성공 시 `/media/fat`, `/media/fat/games`, `/media/fat/MiSTer.ini` 상태를 확인하고 마지막 성공 시간을 저장합니다.

### activeMisterProfile 공유 구조

연결 성공 시 credential이 없는 `activeMisterProfile` 상태를 갱신합니다.

- 포함: profileId, alias, ipAddress, port, username, sessionId, 연결 시간, read-only 확인 요약
- 제외: password, privateKey, passphrase, token, raw credential

다음 화면은 이 active profile을 공통 기준으로 사용합니다.

- 미스터 게임 리스트
- MiSTer 게임 롬 관리
- INI 설정
- 스크립트 관리
- 컨트롤러 관리
- NFC 관리

연결된 MiSTer가 없으면 각 화면에서 “먼저 MiSTer 연결 메뉴에서 연결하세요.” 안내와 연결 메뉴 이동 버튼을 표시합니다.

### 게임 리스트와 ROM 관리의 차이

- 미스터 게임 리스트: MiSTer에 있는 게임 목록, 메타데이터, 카드 만들기, 실행 준비, NFC 연결을 다룹니다.
- MiSTer 게임 롬 관리: PC에서 ROM 추가, MiSTer 대상 폴더 선택, 같은 이름 파일 확인, 저장공간 확인, 덮어쓰기 여부 확인 같은 파일 관리 흐름을 다룹니다.

사용자 화면에서는 `dry-run` 대신 `복사 전 확인` 용어를 사용합니다. 내부 타입과 테스트 이름은 안전 정책 이력을 위해 유지될 수 있습니다.

### 아직 잠긴 기능

다음 기능은 이번 단계에서도 구현하지 않았습니다.

- 실제 ROM copy/upload
- 원격 mkdir/rename/delete/overwrite/upload
- 원격 파일 수정
- reboot/shutdown
- MiSTer.ini 원격 적용
- 스크립트 실행
- SD 포맷/플래싱
- raw command IPC

다음 단계에서는 실제 장치에서 수동 연결, active profile 공유, ROM 복사 전 확인 화면을 먼저 검토한 뒤, 별도 write adapter와 rollback/backup 정책을 확정해야 합니다.
## 연결 유지 / 게임 리스트 / 실행 hotfix

이번 hotfix는 실제 앱 검토에서 확인된 세 가지 문제를 수정한다.

- MiSTer 연결 후 스티커 제작, 미스터 게임 리스트, 카드 앨범 등 다른 메뉴로 이동하면 연결 상태가 끊겨 보이던 문제
- 게임 리스트 동기화에서 가져오기 후보가 비거나 선택 항목이 병합되지 않던 문제
- 카드 앨범에서 게임 실행을 눌렀을 때 active MiSTer 또는 실행 경로가 제대로 연결되지 않아 실패 원인을 알기 어려웠던 문제

### 연결 유지 구조

연결 성공 시 v2의 `activeMisterProfile`을 renderer localStorage뿐 아니라 Electron main process 메모리에도 보관한다. 이 값에는 profileId, IP, port, username, sessionId, read-only 확인 결과만 들어가며 password/privateKey/passphrase/token은 포함하지 않는다.

v1 스티커 기능은 `StickerV1Hydrator`에서 이 active profile을 읽어 v1 project store의 MiSTer connection 상태로 주입한다. 따라서 메뉴 이동 후에도 미스터 게임 리스트, ROM 관리, 카드 앨범, NFC 관리가 같은 active MiSTer/session을 본다.

앱 시작 자동 연결과 저장 후 자동 연결은 계속 비활성이다. 사용자가 한 번 `연결` 버튼을 눌러 세션을 만든 뒤 메뉴를 이동하는 동안에만 같은 세션을 재사용한다.

### 게임 리스트 가져오기

Electron read-only adapter가 `/media/fat/games`의 코어 폴더 목록만 반환하던 흐름을 고쳤다. 이제 각 코어 폴더의 1단계 파일 목록을 읽고 v1의 `MiSTerScanEntry`로 변환한다. 가져오기 목록은 기본 제외 상태를 유지하며, 사용자가 선택한 항목만 force import로 병합된다.

새 플랫폼 판정은 플랫폼 key를 기준으로 기존 라이브러리와 비교한다. 선택한 항목은 기본 import 필터가 꺼져 있어도 사용자의 명시 선택을 우선한다.

### 카드 앨범 실행

카드 앨범은 v1 store의 connection이 아직 갱신되기 전이라도 v2 active MiSTer session을 fallback으로 사용한다. 실행 경로가 없거나 active MiSTer가 없으면 한국어 안내를 표시한다.

현재 v2 Electron bridge에는 안전한 Zaparoo 실행 API가 아직 연결되어 있지 않다. 따라서 raw SSH command로 우회하지 않고, 실행 버튼은 “Zaparoo 실행 API가 아직 연결되지 않았다”는 safe error를 반환한다. 실제 실행 adapter는 추후 Zaparoo/TapTo launch API 경계를 확정한 뒤 연결한다.

### NFC 관리 연결 준비

NFC 관리 화면은 route state로 전달된 게임명/플랫폼/실행 경로를 받을 수 있다. 게임 리스트에서 NFC 관리로 이동할 때 같은 실행 경로를 사용하도록 준비했다. 카드 앨범의 NFC 아이콘은 별도 이동 없이 active MiSTer의 Zaparoo reader에 바로 쓰기를 요청한다. 실제 NFC 쓰기/검증은 기존 안전 잠금 정책을 유지한다.

### 계속 잠긴 기능

- 실제 ROM copy/upload
- 원격 mkdir/rename/delete/overwrite/upload
- 원격 파일 수정
- reboot/shutdown
- MiSTer.ini 원격 적용
- SD 포맷/플래싱
- raw command IPC

## Zaparoo config.toml 안전 적용 마법사

Zaparoo Web UI는 열리지만 카드 앨범 실행이 allow_run 문제로 막힐 때, 앱에서 추천 설정을 만들고 사용자가 확인한 뒤 적용할 수 있습니다.

- 대상 파일은 `/media/fat/zaparoo/config.toml`입니다.
- 원격 백업 파일은 `/media/fat/zaparoo/backups/config.toml.YYYYMMDD-HHmmss.bak` 형식만 허용합니다.
- 로컬 백업은 appData의 `backups/zaparoo/` 아래에 만듭니다.
- 앱은 `[service]` 섹션의 `api_port`, `api_listen`, `allowed_ips`, `allow_run`만 추가 또는 수정합니다.
- 추천 `allow_run`은 `/media/fat/games`와 `/media/fat/_Arcade` 아래 launch만 허용합니다.
- `allowed_ips`는 현재 PC IP 1개만 허용하는 보수 모드와 현재 `/24` subnet을 허용하는 편의 모드 중 선택합니다.
- 적용 전 변경점 미리보기와 백업 위치를 보여주며, 사용자가 확인해야만 SFTP write를 수행합니다.
- 원격 백업이 실패하면 기본적으로 적용을 막고, 사용자가 로컬 백업만으로 계속할지 다시 확인해야 합니다.
- 적용 후 `settings.reload`를 시도합니다. 실패하면 Zaparoo Core 재시작 또는 MiSTer 재부팅 후 다시 진단하라고 안내합니다.
- raw command IPC, 임의 SSH 명령, 일반 원격 write 기능은 추가하지 않습니다.
- Developer mode only: the Zaparoo config apply wizard is hidden in basic and advanced modes.

## NFC 관리 active MiSTer 판정

NFC 관리 화면은 v2 `activeMisterProfile`을 우선 사용하고, renderer 상태가 비어 있을 때는 Electron main의 active profile 동기화와 route payload snapshot을 통해 현재 장치를 다시 확인한다.

NFC 태그 쓰기 준비 조건은 SSH session id가 아니라 다음 네 가지다.

- active MiSTer profile 있음
- Zaparoo Core API 연결됨
- NFC reader 1개 이상
- payload valid

## 컨트롤러 관리

컨트롤러 관리는 고급 모드의 `/controllers` 화면에서 active MiSTer 기준으로 동작한다.

현재 구현 범위:

- `/media/fat`, `/media/fat/config`, config 아래 input/controller/joystick/gamecontrollerdb 후보 폴더, `/media/fat/Scripts`를 read-only SFTP로 제한 스캔한다.
- 후보 파일명은 `gamecontrollerdb*`, `*controller*`, `*joystick*`, `*input*`, `*.map`, `*.cfg`, `*.ini`, `*.txt`에 한정한다.
- 후보 파일 내용은 read-only로 볼 수 있다.
- 텍스트 파일은 텍스트 미리보기로 표시하고, `.map` 또는 binary-like 매핑 파일은 의미를 추정하지 않고 hex/byte 미리보기로 표시한다.
- 백업은 컨트롤러 전용 adapter만 사용하며 `/media/fat/.hello-mister-backups/controllers/**`에 binary-safe 방식으로 저장한다. 가능한 경우 appData 로컬 백업도 함께 만든다.
- 백업 목록에서 선택한 백업은 read-only로 미리보기할 수 있다.
- 복원은 `/media/fat/config/**` 아래 컨트롤러 관련 파일에만 허용하며, 복원 전 현재 파일을 반드시 다시 백업한다.
- 복원 후에는 문자열이 아니라 byte 단위로 다시 읽어 검증한다.
- 백업은 파일당 10개를 유지한다.
- NeoGeo 4버튼, CPS 6버튼, Console Pad 프리셋 구조는 표시하되, 실제 적용은 대상 mapping 파일 구조 확인 전까지 비활성화한다.

계속 제한되는 항목:

- raw command IPC
- 임의 SSH command 실행
- `lsusb`, `dmesg`, `/proc/bus/input/devices` 기반 실시간 장치 감지
- unrestricted remote write
- ROM 탐색기, INI, Zaparoo/NFC 기능 변경

## 게임 리스트 동기화 플랫폼 선택 hotfix

게임 리스트 동기화의 “A. 가져올 플랫폼”은 새 scan/import session이 시작될 때 항상 모두 제외 상태로 초기화됩니다. 이전 config나 카탈로그 기본값이 새 가져오기 대상을 자동 선택하지 않으며, 사용자가 직접 체크한 플랫폼만 가져오기 후보와 병합 대상이 됩니다.

“B. 새 플랫폼 발견”은 새 스캔 결과와 기존 미스터 게임 리스트를 normalized platform key로 비교합니다. 예를 들어 `NEOGEO`, `Neo Geo`, `NeoGeo`, `neo-geo`는 같은 플랫폼으로 보고, `Arcade`와 `_Arcade`, `SNES`와 `Super Nintendo`, `PCE`와 `TGFX16`도 alias 기준으로 묶습니다. 기존 게임 리스트에 이미 있는 플랫폼은 새 플랫폼 발견 목록에 표시하지 않고, 실제로 새로 발견된 플랫폼이 없으면 “새 플랫폼이 없습니다.”를 표시합니다.

가져오기 config 저장은 유지하지만 필터/정렬/alias 같은 설정과 import session 선택 상태를 분리합니다. 안전 기본값은 “모두 제외”이며, 사용자가 선택한 플랫폼만 가져옵니다.

따라서 SSH 세션이 끊겨도 active MiSTer와 Zaparoo API가 살아 있으면 `readers.write`를 사용할 수 있다. active MiSTer가 없으면 MiSTer 연결 안내를 표시하고, Zaparoo API 미연결, reader 없음, payload 오류는 각각 별도 메시지로 표시한다.

## MiSTer 게임 롬 관리 탐색기

MiSTer 게임 롬 관리는 Windows 탐색기나 SMB 네트워크 드라이브를 따로 열지 않고 앱 안에서 ROM 파일을 관리하는 화면이다. 게임 리스트는 카드 제작, 실행, NFC, 메타데이터 연결을 다루고, ROM 관리는 파일 복사, 이동, 이름 변경, 휴지통 이동, 폴더 생성을 다룬다.

### 허용 범위

원격 파일 작업은 ROM 관리 전용 IPC인 `romFs:*`로만 노출한다. 일반 remote write IPC나 raw command IPC는 만들지 않는다. Electron main process는 모든 원격 경로를 검증하며, write 가능한 root는 다음 두 곳으로 제한한다.

- `/media/fat/games`
- `/media/fat/_Arcade`

다음 경로와 동작은 계속 차단한다.

- `/media/fat/MiSTer.ini`, `/media/fat/Scripts`, `/media/fat/config`, `/media/fat/linux`
- `/etc`, `/root` 등 허용 root 밖의 경로
- `..`, Windows 경로 구분자, symlink 우회
- raw SSH command, reboot/shutdown, SD 포맷/플래싱

### 지원 작업

- PC -> MiSTer 복사: temp 파일명 `<filename>.hello-mister-uploading`으로 업로드한 뒤 크기 확인 후 최종 이름으로 전환한다.
- MiSTer -> PC 복사: 사용자가 선택한 PC 폴더 범위 안으로만 복사한다.
- MiSTer -> MiSTer 복사: PC appData 임시 파일을 거쳐 원본은 read-only, 대상은 허용 root 안에서만 쓴다.
- MiSTer 내부 이동/이름 변경: 허용 root 안에서만 수행하고 충돌 기본값은 건너뛰기다.
- 삭제: 기본 삭제는 영구 삭제가 아니라 `.hello-mister-trash/YYYYMMDD-HHmmss/` 아래로 이동한다.
- 새 폴더: 허용 root 안에서만 만들 수 있다.

작업 결과에는 시작/종료 시간, 원본, 대상, 파일 수, 크기, 상태, sanitized message를 기록한다. password, privateKey, passphrase, token은 저장하거나 내보내지 않는다.

### 남은 QA

실제 MiSTer 장치에서 PC -> MiSTer 복사, MiSTer -> PC 복사, 휴지통 이동/복구, MiSTer 간 복사를 수동 확인해야 한다. 이번 구현은 ROM 관리 화면 안에서 제한된 실제 파일 작업을 열었지만, 일반 원격 파일 시스템 편집 기능은 여전히 제공하지 않는다.

## MiSTer 게임 롬 관리 hotfix: PC 탐색과 양방향 보내기

ROM 관리 화면은 연결 성공 상태만으로 “읽기 전용”이라고 표시하지 않고, ROM 관리 전용 capability check를 실행해 `읽기 가능`, `읽기/쓰기 가능`, `쓰기 권한 없음`, `권한 확인 실패`를 구분한다. 쓰기 확인은 SFTP로 `/media/fat/games/.hello-mister-rw-check/` 아래에 작은 temp 파일을 만들고 삭제하는 방식이며, 이 경로도 ROM 관리 허용 root 검증을 통과해야 한다.

탐색기 UI는 PC 파일 패널과 MiSTer 파일 패널을 함께 보여준다. `롬 추가`는 Electron 파일 선택 dialog를 열어 PC ROM 파일을 PC 패널에 표시하고, `PC 폴더 열기`는 사용자가 선택한 폴더 범위 안에서만 PC 파일을 탐색한다. 브라우저 fallback에서는 OS 파일 dialog가 제한된다는 안내를 표시한다.

양방향 파일 흐름은 다음과 같다.

- PC 파일 선택 -> `MiSTer로 보내기` -> 대상 MiSTer 폴더 선택 -> 같은 이름 파일 처리 확인 -> ROM 관리 전용 IPC로 복사
- MiSTer 파일 선택 -> `PC로 보내기` -> PC 대상 폴더 선택 -> 같은 이름 파일 처리 확인 -> ROM 관리 전용 IPC로 복사

PC -> MiSTer 복사는 temp 파일명 `<filename>.hello-mister-uploading`을 사용하고, 업로드 후 파일 크기를 확인한 뒤 최종 파일명으로 rename한다. MiSTer -> PC 복사는 사용자가 선택한 PC 폴더 안으로만 저장하며 완료 후 파일 크기를 확인한다.

계속 차단되는 범위는 `/media/fat/MiSTer.ini`, `/media/fat/Scripts`, `/media/fat/config`, `/media/fat/linux`, `/etc`, `/root` 및 허용 root 밖의 모든 write다. raw command IPC나 unrestricted remote write IPC는 계속 제공하지 않는다.

## ROM 탐색기 UI 정리 hotfix

MiSTer 게임 롬 관리 화면은 일반 연결 상태와 ROM 폴더 권한 상태를 분리해서 표시한다. ROM 관리 전용 capability check가 성공하면 화면에는 `MiSTer 연결됨 · ROM 폴더 읽기/쓰기 가능`처럼 표시되며, 이 화면에서는 더 이상 일반 read-only 배너의 `읽기 전용 연결됨` 문구를 함께 보여주지 않는다.

저장된 MiSTer 표시는 `별칭 @ IP` 형식으로 정리했다. 별칭과 IP가 같은 경우에는 `MiSTer @ IP`로 표시해 `MiSTer192.168...`처럼 중복되어 보이지 않게 했다. 긴 별칭이나 경로는 ellipsis 처리하고 tooltip에 전체 값을 남긴다.

파일 목록은 PC 패널과 MiSTer 패널 모두 같은 탐색기형 grid를 사용한다. 이름, 종류, 크기, 수정일 컬럼을 고정하고 긴 파일명은 줄바꿈하지 않고 말줄임 처리한다. 파일 행에는 전체 경로 tooltip을 제공한다.

내부 시스템 폴더는 기본 목록에서 숨긴다.

- `.hello-mister-rw-check`: ROM 폴더 권한 확인용 임시 폴더
- `.hello-mister-trash`: 휴지통 기능용 내부 폴더

휴지통 보기를 명시적으로 열었을 때만 휴지통 내용을 확인할 수 있다. 개발자 모드에서 별도 내부 폴더 표시 옵션을 둘 수 있지만, 기본 ROM 관리 흐름에서는 숨기는 것이 원칙이다.

선택 패널은 보내기 흐름을 명확히 보여준다. PC 파일을 선택하면 `MiSTer로 보내기`, MiSTer 파일을 선택하면 `PC로 보내기`가 강조되며, 선택이 없을 때는 파일 또는 폴더를 선택하라는 안내를 표시한다. 원격 write 허용 범위는 계속 `/media/fat/games`와 `/media/fat/_Arcade` 아래로 제한된다.

## ROM 탐색기 2분할 UX hotfix

MiSTer 게임 롬 관리는 PC 탐색기와 MiSTer 탐색기를 좌우 2분할 중심으로 보여준다. 오른쪽 선택 상세/작업 로그 패널은 기본 화면에서 제거하고, 작업 기록은 `작업 보기` 패널 안으로 이동했다.

파일 목록의 기본 컬럼은 `이름`, `확장자`, `크기`이다. 수정일과 전체 경로 같은 부가 정보는 기본 화면에서 숨기고, 긴 파일명은 한 줄 ellipsis와 tooltip으로 확인한다. 기본 행 높이와 버튼 간격도 줄여 ROM 파일명이 더 많이 보이도록 했다.

선택 방식은 탐색기 흐름을 따른다.

- 클릭: 단일 선택
- Ctrl/Command+클릭: 선택 추가/해제
- Shift+클릭: 범위 선택
- 빈 영역 드래그: 드래그 선택
- PC 파일을 MiSTer 패널로 드래그: MiSTer로 복사 확인
- MiSTer 파일을 PC 패널로 드래그: PC로 복사 확인
- 우클릭: 복사, 이동, 이름 변경, 휴지통 이동, 정보 보기

드래그 동작의 기본은 복사이며, 이동은 우클릭 메뉴에서 명시적으로 선택한다. 원격 write는 계속 ROM 관리 전용 IPC를 통해서만 수행하며 `/media/fat/games`와 `/media/fat/_Arcade` 밖으로는 허용하지 않는다. raw command IPC와 unrestricted remote write IPC는 계속 만들지 않는다.

## 실제 앱 검증 완료 기록

2026-06-01 기준 실제 앱 검증에서 다음 흐름을 완료 상태로 기록한다.

- 게임 리스트 동기화: 연결된 MiSTer의 게임 목록 스캔과 선택 가져오기 흐름을 확인했다.
- 새 플랫폼 발견 필터: 기존 게임 리스트에 이미 있는 플랫폼은 새 플랫폼 발견 목록에서 제외된다.
- 가져올 플랫폼 기본 체크 해제: 새 가져오기 세션은 모두 제외 상태로 시작하며, 사용자가 직접 선택한 플랫폼만 가져온다.
- 게임 리스트에서 카드 만들기: 미스터 게임 리스트 항목에서 카드 제작 흐름으로 이동할 수 있다.
- 카드 앨범 실행: 카드 앨범 실행 버튼은 Zaparoo 실행 bridge를 사용하며, 실패 시 `allow_run` 등 원인을 안내한다.
- NFC 관리 이동: 게임 리스트에서 NFC 관리 화면으로 선택 게임과 실행 payload를 전달한다. 카드 앨범의 NFC 아이콘은 현재 카드의 실행 payload를 바로 Zaparoo `readers.write`에 보낸다.
- NFC 쓰기/읽기 검증: Zaparoo `readers.write`로 쓰고, `tokens.added` 이벤트 기반으로 읽어 현재 payload와 비교한다.
- ROM 탐색기 양방향 복사: PC -> MiSTer, MiSTer -> PC 복사가 앱 안에서 동작한다.

이 검증 기록은 새 기능 추가가 아니라 현재 완료 상태를 문서화한 것이다. v1 스티커 앱 폴더는 수정하지 않으며, raw command IPC, unrestricted remote write IPC, password 평문 저장 금지는 계속 유지한다.
## INI 목록 새로고침 hotfix

INI 설정 화면의 `INI 목록 새로고침`은 현재 active MiSTer의 `/media/fat` 루트 listing을 기준으로 실제 원격 INI 파일을 다시 만든다. 필터는 대소문자 구분 없이 `.ini` 확장자를 인식하며, `MiSTer.ini`, `MiSTer_alt_*.ini`, `MiSTer_*.ini`를 포함한다. `Other.ini`처럼 `MiSTer`로 시작하지 않는 일반 INI는 기본 원격 목록에서 제외한다.

원격 항목 병합 정책은 원격 파일 우선이다. 실제 MiSTer에 존재하는 파일은 항상 `source=remote`로 표시하고, appData metadata는 가칭 이름, 프리셋 슬롯, 메모만 덧붙인다. metadata가 없어도 원격 파일은 숨기지 않는다. cache에만 남은 항목은 원격 파일을 덮거나 숨기지 않고 별도 source로 구분한다.

원격 SFTP listing에서 파일 type metadata가 불완전해도 디렉터리만 확실히 제외하고, 유효한 `MiSTer*.ini` 파일명 후보는 목록에 표시한다. 개발자 모드에서는 raw `/media/fat` item count, filtered INI count, metadata/cache/final count, excluded reason summary를 확인할 수 있다.

## INI 백업/복원/휴지통 흐름

INI 설정 화면은 선택한 원격 INI의 백업 목록을 보여주고, 백업 파일을 read-only로 미리본 뒤 복원할 수 있다. 복원 전에는 현재 원격 INI가 백업 내용으로 덮어씌워진다는 경고를 표시하며, 적용 전에 현재 파일을 다시 백업한다.

휴지통 이동은 `MiSTer_alt_*.ini`와 `MiSTer_*.ini` 같은 대체/custom INI에만 허용된다. 기본 `MiSTer.ini` 삭제는 차단한다. 휴지통 목록과 복구 버튼은 INI 설정 화면에서 확인할 수 있으며, 휴지통 비우기와 영구 삭제는 이번 단계에서 비활성 상태로 유지한다.

원격 쓰기는 INI 관리 전용 허용 경로로만 제한된다. 백업 미리보기는 해당 INI의 백업 폴더 안 파일만 읽으며, raw command IPC나 unrestricted remote write IPC는 추가하지 않는다.

## INI 설정 2분할 레이아웃 hotfix

INI 설정 화면은 왼쪽 INI 파일 목록과 오른쪽 GUI 편집기 2분할 구조로 정리했다. 기존 오른쪽 이름/프리셋/백업 패널은 제거하고, 가칭 이름, 프리셋 슬롯, 메모 편집을 선택한 INI 목록 항목 안으로 옮겼다. 목록과 편집기 사이에는 크기 조절 splitter를 두며 기본 비율은 목록 30%, 편집기 70%에 가깝게 유지한다.

선택한 INI의 백업 목록과 휴지통 목록은 왼쪽 목록 아래의 접이식 영역에서 관리한다. 백업 복원은 현재 INI가 덮어씌워진다는 경고를 유지하고, 백업 삭제와 휴지통 영구 삭제는 각각 `/media/fat/.hello-mister-backups/ini/**`, `/media/fat/.hello-mister-trash/ini/**` 아래의 검증된 경로에서만 수행한다.

휴지통으로 이동한 원격 INI는 일반 INI 목록에서 즉시 사라지고 휴지통 목록에서만 보이도록 병합 정책을 정리했다. 기본 `MiSTer.ini` 삭제 차단, 저장 전 백업, 백업 10개 유지, raw command IPC 금지, unrestricted remote write IPC 금지 정책은 그대로 유지한다.

## Latest Hotfix: INI Connection Status And Writable Workflows

- INI settings now separates the general MiSTer connection from the INI edit capability.
- The top target area shows the active target as `alias @ IP` and a user-facing status such as `MiSTer 연결됨 · INI 편집 가능`.
- INI write capability is checked through a dedicated guarded SFTP check file under `/media/fat/.hello-mister-backups/ini/`; no unrestricted remote write or raw command IPC is added.
- Save, backup restore/delete, trash move, and trash restore/delete are enabled only after the INI write capability check passes.
- INI list source labels are user-facing: `MiSTer에서 읽음`, `로컬`, `업로드 준비`, `원격 없음`, and `캐시`.
- The default INI list metadata UI is memo-centered. Existing display name/preset metadata is preserved but no longer forced as primary editing fields.
- Memo edits are saved to appData metadata only and do not modify the remote INI file or create INI dirty state.

## Latest Hotfix: INI Delete Actions By Source

- Remote `MiSTer_alt_*.ini` and `MiSTer_*.ini` entries move to `/media/fat/.hello-mister-trash/ini/` through the restricted INI adapter.
- Remote `MiSTer.ini` deletion remains blocked.
- Local import, upload-ready, cache, and remote-missing INI entries are removed from the appData list only; they do not trigger SFTP or remote file work.
- Trash entries stay out of the normal INI list and are handled only in the trash restore/delete area.
- The INI save, backup, GUI edit, raw command ban, and unrestricted remote write ban remain unchanged.

## Game List Sync Custom Platforms

MiSTer game list sync now supports user-defined platforms discovered from folder-based layouts such as `/media/fat/_Arcade/PGM`.

- New scanned platforms are not automatically imported.
- Unknown folders appear in the “new platform discovery” area until the user chooses what they mean.
- The user can register an unknown folder as a custom platform with display name, aliases, source root, extensions, parent system, and card category.
- The default scan/import safety state remains unchecked for unregistered platforms.
- Registering a folder as a custom platform only saves the platform definition. It does not merge games automatically.
- The user must click the explicit library merge action to add that source root's current scan entries to the MiSTer game list.
- Duplicate absolute MiSTer paths are skipped during that explicit merge.
- The user can mark a folder as “classification folder only” when it is a grouping folder rather than a real platform.
- PGM aliases such as `PGM`, `IGS PGM`, and `PolyGame Master` normalize to the same platform key.
- Custom platform configuration is stored in the v2 app data / sticker library state, not in the v1 source folder.
- The flow does not add raw command IPC, generic remote write IPC, ROM copy/upload behavior, or plaintext credential storage.

## Game List Sync Arcade Root Scan

Game list sync scans both MiSTer library roots through the existing read-only SFTP bridge:

- `/media/fat/games`
- `/media/fat/_Arcade`

The `/media/fat/games` root keeps the existing one-level core/platform folder scan. The `/media/fat/_Arcade` root now also scans root `.mra` files as `Arcade` entries and one-level subfolders such as `/media/fat/_Arcade/PGM` as custom platform candidates. Files like `/media/fat/_Arcade/PGM/game.mra`, `.zip`, and other existing allowed playable extensions are passed through the same scan/import pipeline.

New platforms remain unchecked by default, and the new platform discovery list still excludes platforms already present in the saved MiSTer game list or registered custom platform catalog. This change does not add raw command IPC, generic remote write IPC, ROM copy/upload behavior, or plaintext credential storage.

Registered custom arcade platforms are stored in appData-backed sticker library state with source root, optional core root, extensions, card category, and launch format metadata. After the user runs the explicit library merge, games from the selected `_Arcade/<folder>` source root use the custom platform display name in the MiSTer game list and stay eligible for card creation, Zaparoo launch, and NFC management.

## Custom Platform Scan Diagnostics

Custom platform source scans now separate discovered files from final game candidates. The scan detail panel reports source root, scan range, scanned folders, total files, MRA files, extension-filtered files, duplicate full paths, depth-limited folders, failed folders, and final candidates.

For MRA-based arcade folders such as `/media/fat/_Arcade/PGM`, `.mra` files are treated as game launch candidates. ROM bundles such as `.zip` are counted in the scan totals but excluded by default unless the custom platform extension settings explicitly include them. Candidate deduplication uses the full MiSTer path, so matching titles in different folders are not removed before the merge step.

When a custom platform extension setting includes `.mra`, every matching `.mra` file under the selected scan range becomes a game candidate. MRA title parsing, core verification, metadata lookup, and official platform registry lookup failures are warnings/status details only; they do not remove the candidate. Generic file names such as `game.mra` fall back to the parent folder name for the game title.

This diagnostic change uses the existing read-only SFTP listing path. It does not add raw command IPC, remote write IPC, ROM explorer file operations, or plaintext credential storage.

## Latest Hotfix: Sticker Menu And Card Image Transforms

- The Sticker Production sidebar no longer shows `프로젝트 게임`.
- The legacy `/stickers/project-games` route remains as a compatibility redirect to `/stickers/mister`.
- The `/stickers/editor` sidebar label is now `카드편집`.
- Changing an existing card template preserves the card's current main/logo image transforms instead of resetting them to the new template default.
- Preserved fields include position, scale, size, crop, rotation, fit mode, and slot override data.
- When the next template uses different image layer ids, the existing main/logo transform is mapped onto the next matching image slot.
- Batch image matching still applies the v1 centered image zoom default to newly matched main images only; manually adjusted cards are not reset by template changes.

## Latest Hotfix: PC / MiSTer File Transfer Manager

- `MiSTer 게임 롬 관리` now behaves as a PC / MiSTer file transfer manager instead of a ROM-root-only explorer.
- The MiSTer pane now uses a tree-style folder browser like the PC pane. Users can expand `/`, `/media`, `/media/fat`, `/media/fat/games`, `/media/fat/_Arcade`, and other readable folders in-app instead of relying on quick path buttons.
- MiSTer remote browsing and SFTP file operations now accept normalized absolute MiSTer paths instead of being limited to `/media/fat/games` and `/media/fat/_Arcade`.
- The guard still blocks path traversal (`..`), Windows path separators, null bytes, symlink paths, raw command IPC, and plaintext credential storage.
- Trash view now opens the centralized `/media/fat/.hello-mister-trash` folder. Files moved from different MiSTer folders keep their original relative path under a timestamped trash folder so one trash view can show all moved items.
- A connected MiSTer now enables SFTP read/write actions in the file manager without a separate temp-file write capability gate. If the MiSTer filesystem rejects a specific path, the failed operation returns the user-facing error.
- The old ROM dry-run planning/review panels below the file transfer manager are hidden. The screen focuses on direct PC / MiSTer file browsing, copy, move, rename, folder creation, and trash workflows.
