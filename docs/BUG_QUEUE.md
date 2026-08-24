# Bug Queue

Last verified HEAD when this document was introduced: `7a29deb`.

## BUG-060

- ID: BUG-060
- Screen: Stickers > Card album
- Action: Click the NFC icon on a saved card.
- Problem: The NFC icon opened the NFC management page instead of writing the selected card directly.
- Expected behavior: Clicking the NFC icon writes the selected card's launch payload directly through the existing safe Zaparoo `readers.write` bridge, shows writing/success/error state in the card album, and records the tag write job. It must not add raw command IPC or route through a generic remote command path.
- Priority: Medium
- Status: Complete, manual QA needed
- Related commit: `fix: write nfc directly from card album`
- Resolution:
  - Changed card album NFC action from route navigation to direct `HttpMiSTerBridgeClient.writeTag`.
  - Reused active MiSTer profile/connection config and Zaparoo reader checks.
  - Added success feedback text for direct card writing.

## BUG-059

- ID: BUG-059
- Screen: Stickers > NFC management
- Action: Select a game, write NFC, and check reader state.
- Problem: The NFC management screen still exposed implementation-oriented payload preview copy, a manual launch-text generation button, an internal path-selection reason, and write-completion wording that said the write request completed instead of the write completing.
- Expected behavior: Selecting a game prepares the launch text automatically. The screen shows NFC reader connection state instead of payload preview/status details. NFC write completion says `쓰기 완료`, and internal selection reasoning is hidden.
- Priority: Medium
- Status: Complete, manual QA needed
- Related commit: `fix: simplify nfc write status copy`
- Resolution:
  - Removed the manual launch-text generation and NFC data preparation buttons from the NFC management action row.
  - Replaced the payload preview panel with an NFC reader status panel.
  - Changed write completion wording from request completion to `쓰기 완료`.
  - Hid internal launch path selection reason and payload-prepared/readiness copy from the NFC management screen.

## BUG-058

- ID: BUG-058
- Screen: MiSTer FPGA > MiSTer game ROM management
- Action: Navigate PC/MiSTer folders and manage the central MiSTer trash.
- Problem: The PC pane did not expose explicit previous/parent navigation, the MiSTer pane had parent navigation but no previous button, and the central trash view did not expose a permanent delete action.
- Expected behavior: Both PC and MiSTer panes should show `이전` and `상위` buttons. The central `/media/fat/.hello-mister-trash` view should allow selected trash items to be permanently deleted only after confirmation, while preventing deletion outside the central trash folder and preventing deletion of the trash root itself.
- Priority: Medium
- Status: Complete, live-device manual QA needed
- Related commit: `fix: add file manager navigation and trash delete`
- Resolution:
  - Added visible previous/parent navigation controls to both PC and MiSTer panes.
  - Added a ROM-manager scoped `romFs:deleteRemote` IPC for permanent trash deletion.
  - Restricted permanent deletion to children of `/media/fat/.hello-mister-trash`.
  - Reused guarded SFTP file operations and did not add raw command IPC or unrestricted remote write IPC.

## BUG-057

- ID: BUG-057
- Screen: MiSTer FPGA > MiSTer game ROM management
- Action: Browse MiSTer folders before copying files between PC and MiSTer.
- Problem: The MiSTer side still depended on quick path buttons for locations like `/media`, `/media/fat`, `/media/fat/games`, and `/media/fat/_Arcade`, while the PC side already had an Explorer-style tree.
- Expected behavior: The MiSTer side should also show a scrollable folder tree. Clicking a remote folder node opens that folder, expands children through the existing SFTP list IPC, and supports PC-to-MiSTer drag/drop copy onto tree folders.
- Priority: Medium
- Status: Complete, live-device manual QA needed
- Related commit: `fix: show mister folder tree in file manager`
- Resolution:
  - Added MiSTer remote tree state, expansion, loading, and selected-folder tracking in the file transfer manager.
  - Reused existing `romFs:listRemote` SFTP listing instead of adding raw command IPC or unrestricted remote write IPC.
  - Rendered the MiSTer pane with the same tree plus file-list split used by the PC pane.
  - Hid the old quick path button strip in favor of the tree.
  - Added PC-to-MiSTer drag/drop copy support for remote tree folder rows.

## BUG-056

- ID: BUG-056
- Screen: MiSTer FPGA > MiSTer game ROM management
- Action: Browse PC files before copying ROMs between PC and MiSTer.
- Problem: The ROM explorer required clicking a `PC folder` button and choosing a folder dialog before browsing local files, so it did not feel like a Windows Explorer-style file manager.
- Expected behavior: The PC side of the ROM explorer shows a folder tree by default, lets the user expand local drives/folders in-app, and loads the selected folder into the file list without opening a separate folder-picker dialog.
- Priority: Medium
- Status: Complete, live-device manual QA needed
- Related commit: `fix: show pc folder tree in rom explorer`
- Resolution:
  - Added ROM-manager scoped local tree IPC for local drive roots and child folders.
  - Rendered a compact PC folder tree beside the PC file list.
  - Kept PC file selection, multi-select, drag/drop copy, and MiSTer-side allowed-root write guards intact.
  - Did not add raw command IPC, unrestricted remote write IPC, or changes to the v1 source folder.

## BUG-055

- ID: BUG-055
- Screen: MiSTer FPGA > Controller management > Preset candidates
- Action: Save a SHA-256 candidate group as a local controller map preset.
- Problem: The `Save this group as preset` action could appear to do nothing because it used the old prompt-based save path and did not keep visible loading/error/success state in the app UI.
- Expected behavior: Clicking the candidate save button opens an in-app modal with the selected group details, default preset name/type, notes, representative file selection, duplicate handling, and explicit save/cancel actions. Saving reads only one representative `.map` file, verifies its SHA-256 against the candidate group, updates the local preset list immediately, and shows errors in the modal.
- Priority: High
- Status: Complete, live-device manual QA needed
- Related commit: `fix: open and save controller preset candidates`
- Resolution:
  - Added an in-app candidate save modal instead of relying on a prompt.
  - Showed representative file, controller key, byte length, SHA-256, file count, and sample game keys before saving.
  - Added preset type defaults including `Arcade Common`, editable notes, and representative file selection within the same SHA group.
  - Added duplicate handling for matching `controllerKey + presetType + sha256` with replace or save-as-copy choices.
  - Kept save reads limited to the selected representative `.map` file and reuses the existing SHA verification helper.
  - Added visible loading/error/success state, a saved badge on rows, and developer diagnostics for the last preset save action.
  - Kept remote `.map` writes disabled and did not add raw command IPC, arbitrary SSH exec, unrestricted remote write IPC, or credential export.

## BUG-054

- ID: BUG-054
- Screen: MiSTer FPGA > Controller management
- Action: Turn exported controller `.map` analysis into usable local preset candidates.
- Problem: The app could export SHA-256 analysis data, but the controller screen did not group identical `.map` files into one-click preset candidates. Users still had to inspect thousands of map files manually, and exception-sized 2048-byte maps were not separated from default 128-byte apply candidates.
- Expected behavior: Controller management groups maps by `controllerKey + byteLength + sha256`, defaults to the dominant controller key and 128-byte candidates, shows representative files and sample game keys, separates 2048-byte exception groups, and saves only a representative `.map` byte payload as a local preset.
- Priority: High
- Status: Complete, live-device manual QA needed
- Related commit: `feat: add controller preset candidates by map hash`
- Resolution:
  - Added SHA-group preset candidates based on `controllerKey + byteLength + sha256`.
  - Defaulted the candidate view to the dominant controller key and 128-byte groups with at least five files.
  - Kept 2048-byte map groups visible only as exceptions and excluded them from default preset saving.
  - Stored only SHA status while preparing candidates, then read only the selected representative file when saving a preset.
  - Tightened dry-run apply eligibility to same controller key, same byte length, and `/media/fat/config/inputs/*.map` target paths.
  - Kept actual remote `.map` writes disabled and did not add raw command IPC, arbitrary SSH exec, unrestricted remote write IPC, or credential export.

## BUG-053

- ID: BUG-053
- Screen: MiSTer FPGA > Controller management
- Action: Export controller `.map` analysis results for external review.
- Problem: The controller map analysis export read every `.map` file and included full byte payloads by default, so live-device exports with thousands of map files could sit at progress such as `973/2867` for too long.
- Expected behavior: Default export is lightweight and suitable for ChatGPT grouping/preset-candidate analysis without full bytes. Summary mode uses scan metadata without remote file reads, hash mode includes SHA-256 but excludes `bytesBase64`, `hex`, and `decimalBytes`, and full bytes are exported only through explicit advanced selected-group/all-files actions with warning/cancel support.
- Priority: High
- Status: Complete, live-device manual QA needed
- Related commit: `fix: make controller map analysis export lightweight`
- Resolution:
  - Split controller map analysis export into `summary`, `hash`, and `full` modes.
  - Made the recommended ZIP use lightweight hash analysis data instead of full byte payloads.
  - Kept metadata-only export free of remote file reads.
  - Kept full byte data limited to explicit selected-group or all-files export paths.
  - Added a warning confirmation before all-files full byte export.
  - Added conservative read concurrency, progress text by mode, and a cancel path.
  - Kept raw command IPC, arbitrary SSH exec, unrestricted remote write IPC, and credential export banned.

## BUG-052

- ID: BUG-052
- Screen: MiSTer FPGA > Controller management
- Action: Export controller `.map` analysis results for external review.
- Problem: Controller map analysis could parse filenames, compare bytes, and group maps, but users had no structured export to upload to ChatGPT for platform grouping or preset-candidate review.
- Expected behavior: The controller management screen can export a ZIP package containing JSON, CSV group files, and a README. The export includes raw structured map data such as file name, remote path, inferred game/controller key, VID/PID/version, byte length, SHA-256, bytesBase64/hex/decimal bytes, conservative platform guesses, and groups by controller, game, SHA-256, byte length, and platform.
- Priority: High
- Status: Complete, live-device manual QA needed
- Related commit: `feat: export controller map analysis data`
- Resolution:
  - Added a controller map export service with schema versioned JSON, summary JSON, CSV files, and ZIP packaging.
  - Added export buttons for ZIP, JSON, CSV, and summary output in the controller map analysis section.
  - ZIP output includes `controller-map-analysis.json`, file/group CSVs, and `README.txt` explaining how to upload the package to ChatGPT.
  - Kept matched library platform separate from conservative `platformGuess`.
  - Kept byte values raw and explicitly did not infer button meanings such as A/B/X/Y.
  - Kept passwords, private keys, passphrases, tokens, local Windows user paths, raw command IPC, arbitrary SSH exec, and unrestricted remote write out of the export flow.

## BUG-051

- ID: BUG-051
- Screen: MiSTer FPGA > Controller management
- Action: Analyze `.map` controller files, compare two files, group maps by inferred controller/game key, save a selected map as a local preset, and preview preset-to-target apply changes.
- Problem: Controller `.map` files could be previewed as bytes, but the app did not help users compare multiple game/core map files for the same joystick, group maps by filename-derived keys, or prepare a local preset workflow without guessing button meanings.
- Expected behavior: The app parses names like `1941r_input_16D0_1358_v3.map` into inferred game/controller/VID/PID/version fields, groups `.map` files by controller key, game key, and byte length, shows byte-offset diffs, stores selected `.map` bytes as local presets, and creates a dry-run apply plan without writing remote files.
- Priority: High
- Status: Complete, live-device manual QA needed
- Related commit: `feat: add controller map analysis and presets`
- Resolution:
  - Added read-only `bytesBase64` and `sha256` to controller file preview responses for exact byte comparison.
  - Added a pure controller map analysis service for filename parsing, grouping, byte diff, frequent offset summary, local preset storage, and apply-plan dry-runs.
  - Added controller management UI sections for map analysis, local map presets, and apply preparation.
  - Kept actual remote `.map` apply disabled; dry-run only shows diff, warnings, controllerKey match, byte length match, and backup requirement.
  - Kept raw command IPC, arbitrary SSH exec, unrestricted remote write IPC, and password plaintext storage banned.

## BUG-050

- ID: BUG-050
- Screen: MiSTer FPGA > Controller management
- Action: View `.map` controller files, create controller backups, preview backups, and restore a selected backup.
- Problem: Controller backup/restore existed structurally, but file content and backups were handled as UTF-8 text. Binary-like `.map` files could render as broken text, and restore verification compared strings instead of bytes. Backup preview was also missing.
- Expected behavior: Controller files remain read-only in the preview, `.map` files use byte/hex preview, backups are created through the controller-only adapter, backup lists can be previewed, and restore first creates a backup of the current file before writing and verifying restored bytes.
- Priority: High
- Status: Complete, live-device manual QA needed
- Related commit: `feat: add controller backup restore and map previews`
- Resolution:
  - Added controller-only `readControllerFile` and `readBackup` IPC channels alongside the existing scan/create/list/restore channels.
  - Switched controller backup/restore content handling to Buffer reads/writes and byte comparison verification.
  - Kept backup writes under `/media/fat/.hello-mister-backups/controllers/**` and restore writes limited to controller-related files under `/media/fat/config/**`.
  - Added backup metadata with original path, file size, source profile, and SHA-256 when possible.
  - Added read-only text/hex preview formatting so `.map` and binary-like files show bytes instead of broken text.
  - Restore now stops if the current target file cannot be auto-backed-up first.
  - Kept raw command IPC, arbitrary SSH exec, unrestricted remote write IPC, and password plaintext storage banned.

## BUG-049

- ID: BUG-049
- Screen: MiSTer FPGA > Controller management
- Action: Click controller inventory refresh on an active MiSTer profile.
- Problem: Packaged runtime could show `No handler registered for 'controllerFs:scanInventory'`, leaving the scan in an error state before the read-only SFTP inventory could run.
- Expected behavior: Electron main registers `controllerFs:scanInventory` before the BrowserWindow is created, preload invokes the same shared channel, and the renderer receives a normal controller inventory result with candidate roots, scanned roots, failed roots, final status, and timing diagnostics.
- Priority: High
- Status: Complete, live-device manual QA needed
- Related commit: `fix: register controller inventory scan ipc`
- Resolution:
  - Added a shared Electron controller IPC channel module used by both main and preload.
  - Split controller IPC registration into a dedicated guarded function and register it before window creation.
  - Added renderer-side missing-handler classification with candidate root diagnostics so stale Electron main processes point users to restart the latest build.
  - Extended Electron smoke coverage to invoke `controllerFsScanInventory` directly and fail on `No handler registered`.
  - Kept the controller scan read-only; no raw command IPC, arbitrary SSH exec, unrestricted remote write, or password plaintext storage was added.

## BUG-048

- ID: BUG-048
- 화면: MiSTer FPGA > 컨트롤러 관리
- 동작: `설정 파일 새로고침`을 눌러 active MiSTer의 컨트롤러 관련 설정 파일을 스캔한다.
- 문제: 버튼을 눌러도 화면이 `컨트롤러 설정 파일을 읽는 중입니다.` 상태에 머물고, 후보 파일/스캔 폴더/실패 경로가 모두 0으로 보이며 개발자 상세도 `{}`처럼 비어 보일 수 있었다.
- 기대 동작: 스캔은 항상 `ready`, `empty`, `partial`, `error`, `timeout` 중 하나로 종료되어야 한다. 후보 파일이 없어도 정상적인 `empty` 상태로 끝나고, 실패 경로와 diagnostics가 표시되어야 한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: complete controller settings refresh scans`
- 처리 내용:
  - 컨트롤러 inventory 결과에 명시적인 최종 status, startedAt/finishedAt, durationMs, candidateRoots, scannedRoots, failedRoots, errors diagnostics를 추가했다.
  - Electron main의 bounded read-only scan이 일부 경로 실패를 전체 실패로 만들지 않고 `partial`로 반환하게 정리했다.
  - 후보 파일이 없는 경우 `empty` 상태로 종료하고 버튼을 다시 누를 수 있게 했다.
  - scan 전체와 경로별 읽기에 timeout guard를 추가했다.
  - renderer에서 stuck promise를 timeout 결과로 종료하고, unmount 또는 재시도 후 늦게 끝난 promise가 상태를 덮어쓰지 않게 했다.
  - raw command IPC, 임의 SSH command, unrestricted remote write는 추가하지 않았다.

## BUG-036

- ID: BUG-036
- 화면: 전체 사이드바
- 동작: 상위 메뉴를 펼치거나 접고, 하위 메뉴에서 각 기능 화면으로 이동한다.
- 문제: MiSTer 연결, ROM 관리, INI 설정 등 MiSTer 기능이 개별 상위 메뉴처럼 흩어져 있고 스티커 제작 parent만 접기/펼치기 구조라 사이드바가 산만했다.
- 기대 동작: 상위 메뉴는 `MiSTer FPGA`, `스티커 제작`, `설정` 세 개만 남긴다. 세 parent는 기본 접힘 상태이고, parent 클릭은 펼침/접힘만 수행하며, 하위 메뉴 클릭만 route 이동을 수행한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: reorganize sidebar into mister sticker settings groups`
- 처리 내용:
  - MiSTer 기능을 `MiSTer FPGA` parent 아래로 묶었다.
  - v1 스티커 기능을 `스티커 제작` parent 아래에 유지했다.
  - 앱 설정과 백업/복구를 `설정` parent 아래로 정리했다.
  - 기존 `/connection` route는 `/mister`로 redirect하고, 새 사이드바는 `/mister`를 사용한다.
  - 메뉴 배치와 route wiring만 변경했으며 MiSTer 연결, ROM 탐색기, INI 저장/백업/휴지통, Zaparoo/NFC 로직은 변경하지 않았다.

## BUG-035

- ID: BUG-035
- 화면: MiSTer 연결 / 공용 active MiSTer 상태 / ROM 관리 / INI 설정
- 동작: MiSTer 연결 상태와 기능별 권한 상태를 확인한다.
- 문제: MiSTer 연결 페이지와 공용 active MiSTer 배너가 “읽기 전용 연결”처럼 표시되어, ROM 관리와 INI 설정처럼 기능별로 제한된 쓰기 권한을 확인하는 화면과 상태가 충돌해 보였다.
- 기대 동작: 메인 연결은 “MiSTer 연결됨” 또는 “수동 연결 확인”으로 표시하고, ROM/INI/Zaparoo/NFC 권한은 각 기능 화면에서만 “ROM 폴더 읽기/쓰기 가능”, “INI 편집 가능”, “Zaparoo Core API 연결됨”, “NFC 리더 연결됨”처럼 표시한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: normalize user facing status labels`
- 처리 내용:
  - MiSTer 연결 페이지의 성공/실패/저장 안내에서 “읽기 전용 연결/확인”과 “자동 연결” 중심 문구를 제거하고 수동 연결 상태 확인 문구로 정리했다.
  - 공용 active MiSTer 배너의 상태 배지를 “MiSTer 연결됨”으로 바꿨다.
  - Game Management의 연결 필요 안내도 “MiSTer 연결 메뉴에서 확인한 연결” 기준으로 정리했다.
  - 공통 연결 단계 formatter에서 세션 인증/읽기 전용 검증 표현을 IP 입력, MiSTer 저장, 수동 연결, 신뢰 키 확인, 연결 상태 확인 흐름으로 바꿨다.
  - raw command IPC, unrestricted remote write IPC, password 평문 저장 정책은 변경하지 않았다.

## BUG-034

- ID: BUG-034
- 화면: INI 설정
- 동작: INI 권한 확인, INI 저장 백업 생성, custom INI 휴지통 이동을 실행한다.
- 문제: 원본 INI 파일명 validator가 backup/trash/capability check 같은 시스템 경로에도 섞여 적용되어 `.hello-mister-ini-write-check.tmp`, timestamp 백업 파일, `20260608-153012-MiSTer_NM.ini` 휴지통 파일이 일반 INI 파일명처럼 거부될 수 있었다.
- 기대 동작: 원본 INI 파일명, `/media/fat` 루트 INI 파일 경로, backup 경로, trash 경로, capability check temp 경로를 각각 별도 validator로 검증한다. `MiSTer_NM.ini` 같은 custom INI 저장/휴지통 이동은 동작하고, `MiSTer.ini` 삭제 차단과 path traversal/허용 범위 밖 write 차단은 유지한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: separate ini filename and system path validation`
- 처리 내용:
  - Electron main의 INI path guard를 `assertIniRootWritePath`, `assertIniBackupWritePath`, `assertIniTrashWritePath`, `assertIniWriteCheckPath`로 분리했다.
  - backup/trash/capability 경로가 일반 INI 파일명 validator를 먼저 통과하지 않도록 dispatch 순서를 보강했다.
  - INI 저장은 root INI target validator와 backup validator를 명시적으로 사용한다.
  - INI 휴지통 이동은 timestamp trash target validator를 명시적으로 사용한다.
  - raw command IPC와 unrestricted remote write IPC는 추가하지 않았다.

## BUG-033

- ID: BUG-033
- 화면: INI 설정
- 동작: custom INI를 저장하거나 휴지통으로 이동한다.
- 문제: `MiSTer_NM.ini` 같은 안전한 `MiSTer_*.ini` 파일이 일부 validator/guard 경로에서 막히고, 저장/휴지통 실패 시 실제 실패 단계가 사용자에게 충분히 드러나지 않았다.
- 기대 동작: 안전한 `MiSTer_이름.ini` custom 파일은 저장/백업/휴지통 이동에 사용할 수 있다. `MiSTer.ini` 삭제는 계속 차단하고, path traversal과 허용 경로 밖 write는 계속 차단한다. 저장은 원격 백업, 새 INI 저장, 저장 후 다시 읽기까지 완료하며, 휴지통 이동은 SFTP rename 후 일반 목록/휴지통 목록을 즉시 갱신한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: repair ini save and trash execution`
- 처리 내용:
  - renderer validator가 원본 입력을 검증한 뒤 basename을 반환하도록 보강했다.
  - INI write capability check가 백업 폴더 쓰기, 허용된 custom INI 임시 파일 쓰기, INI 전용 휴지통 rename을 함께 확인하도록 보강했다.
  - INI 저장 IPC는 `readCurrent`, `createBackup`, `writeRemote`, `rereadRemote`, `pruneBackups` 단계를 안전한 실패 메시지에 포함한다.
  - INI 휴지통 IPC는 `locateSource`, `createTrashDir`, `moveToTrash` 단계를 안전한 실패 메시지에 포함한다.
  - 저장 성공 후 목록과 편집기 document를 원격 파일 기준으로 다시 갱신하고, 휴지통 이동 성공 후 일반 목록에서 제거한 뒤 휴지통 목록을 새로고침한다.
  - raw command IPC와 unrestricted remote write IPC는 추가하지 않았다.

## BUG-032

- ID: BUG-032
- 화면: INI 설정
- 동작: `MiSTer_NM.ini` 같은 custom named INI를 휴지통으로 이동한다.
- 문제: `MiSTer_*.ini` 규칙에 맞는 custom INI가 validator 또는 휴지통 path guard에서 허용되지 않는 회귀가 발생할 수 있었다.
- 기대 동작: `MiSTer_NM.ini`, `MiSTer_CRT.ini`, `MiSTer_example.ini` 같은 안전한 custom `MiSTer_이름.ini` 파일은 INI 전용 휴지통 이동을 허용한다. 기본 `MiSTer.ini` 삭제는 계속 차단한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: allow custom MiSTer named ini files`
- 처리 내용:
  - renderer와 Electron main validator가 exact alt slot과 custom `MiSTer_이름.ini` 규칙을 명확히 사용하도록 정리했다.
  - `MiSTer_NM.ini`, `MiSTer_CRT.ini`, `MiSTer_example.ini`의 휴지통 이동 허용 회귀 테스트를 추가했다.
  - path traversal, slash/backslash, `..`, null byte, `.ini`가 아닌 파일명, 허용 경로 밖 write 차단은 유지했다.

## BUG-031

- ID: BUG-031
- 화면: INI 설정
- 동작: 원격 alt/custom INI를 휴지통으로 이동하거나 휴지통 항목을 복구/영구 삭제한다.
- 문제: UI가 `iniWritable` 사전 확인 상태에 묶여 있어 실제 INI 전용 SFTP 작업을 시도하기 전에 삭제/휴지통 작업이 차단될 수 있었다.
- 기대 동작: `MiSTer.ini` 삭제 차단은 유지하되, 원격 alt/custom INI의 휴지통 이동과 휴지통 항목 복구/영구 삭제는 사용자가 확인하면 제한 IPC까지 도달한다. 실제 권한/경로/파일명 오류는 Electron main의 INI 전용 guard가 판단해 한국어 오류로 반환한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: unblock restricted ini trash actions`
- 처리 내용:
  - 원격 INI 휴지통 이동 버튼이 stale write-capability 상태만으로 비활성화되지 않게 했다.
  - 휴지통 복구/영구 삭제 버튼도 confirm 후 제한 IPC까지 도달하도록 열었다.
  - `MiSTer.ini` 삭제 차단, INI 파일명 검증, `/media/fat/.hello-mister-trash/ini/**` 경로 제한, raw command IPC 금지는 유지했다.

## BUG-030

- ID: BUG-030
- 화면: INI 설정
- 동작: `MiSTer_NM.ini` 같은 custom named INI를 휴지통으로 이동한다.
- 문제: `MiSTer_NM.ini`는 `MiSTer_*.ini` 규칙에 맞는 custom INI인데도 파일명 validator가 허용하지 않는 INI 파일명 오류를 표시할 수 있었다.
- 기대 동작: `MiSTer.ini`, `MiSTer_alt_*.ini`, 안전한 `MiSTer_이름.ini` custom INI를 허용한다. `MiSTer.ini`는 계속 삭제 차단하고, alt/custom INI는 INI 전용 휴지통으로 이동할 수 있다. path traversal, slash, null byte, `.ini`가 아닌 파일, 허용 경로 밖 write는 계속 차단한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: allow custom MiSTer named ini files`
- 처리 내용:
  - renderer와 Electron main의 INI 파일명 validator를 같은 safe name body 규칙으로 맞췄다.
  - `MiSTer_NM.ini`, `MiSTer_CRT.ini`, `MiSTer_example.ini`, 괄호가 포함된 안전한 custom name을 허용한다.
  - `Other.ini`, `MiSTer.txt`, `../MiSTer_NM.ini`, slash/backslash 포함 이름, `..` 포함 이름은 계속 차단한다.
  - `MiSTer.ini` 삭제 차단과 INI 전용 휴지통 SFTP rename 정책은 유지했다.

## BUG-029

- ID: BUG-029
- 화면: INI 설정
- 동작: 원격 custom/alt INI 삭제 버튼을 누르고 확인 modal에서 확인한다.
- 문제: 확인 문구는 표시되지만 이후 휴지통 이동이 진행 중인지 알 수 없고, 실패 예외나 목록 갱신이 약해 실제 파일이 이동하지 않은 것처럼 보였다.
- 기대 동작: 확인 후 즉시 휴지통 이동 진행 메시지를 보여주고, INI 전용 `iniFs:trashIni` IPC로 `/media/fat/.hello-mister-trash/ini/` 아래에만 SFTP rename을 수행한다. 성공하면 일반 INI 목록에서 즉시 제거하고 휴지통 목록을 다시 읽는다. 실패하면 한국어 오류를 표시한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: execute ini trash move after confirmation`
- 처리 내용:
  - 원격 INI 휴지통 이동 confirm 이후 `trashActionPendingKey`로 진행 상태를 표시한다.
  - 성공 시 현재 INI 목록에서 대상 파일을 즉시 제거하고 휴지통 패널을 열어 목록을 다시 읽는다.
  - metadata/cache 정리 실패가 원격 이동 성공을 가리지 않도록 분리하고, 실패 시 별도 안내를 붙인다.
  - `MiSTer.ini` 삭제 차단, INI 전용 휴지통 경로 제한, raw command IPC 금지 정책은 유지했다.

## BUG-028

- ID: BUG-028
- 화면: INI 설정
- 동작: INI 파일 목록에서 삭제 버튼을 누른다.
- 문제: 원격 INI와 로컬/업로드 준비/cache 항목이 같은 삭제 흐름을 타면서, 원격 alt/custom INI는 휴지통으로 이동되지 않고 로컬 항목도 목록에서 제거되지 않았다.
- 기대 동작: `MiSTer.ini` 원격 파일은 삭제를 차단한다. 원격 `MiSTer_alt_*.ini`와 `MiSTer_*.ini`는 `/media/fat/.hello-mister-trash/ini/`로 이동한다. 로컬 가져오기, 업로드 준비, cache, 원격 없음 항목은 원격 SFTP 작업 없이 appData 목록에서만 제거한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: handle ini delete actions by source`
- 처리 내용:
  - INI 목록 삭제 버튼을 source별로 분기해 원격 항목은 INI 전용 휴지통 adapter를 사용하고, 로컬/업로드 준비/cache/원격 없음 항목은 appData metadata에서 제거하도록 정리했다.
  - `MiSTer.ini` 원격 삭제 차단 정책을 유지하고, alt/custom 원격 INI만 휴지통 이동 버튼을 활성화한다.
  - 로컬 계열 삭제는 원격 SFTP 호출 없이 현재 목록과 appData metadata를 즉시 갱신한다.
  - 휴지통 항목은 일반 INI 목록이 아니라 휴지통 영역의 복원/영구 삭제 흐름에서만 다룬다.

## BUG-027

- ID: BUG-027
- 화면: INI 설정
- 동작: 연결된 MiSTer의 INI 파일을 보고, 저장/백업/휴지통 작업을 수행한다.
- 문제: INI 화면이 실제로는 백업/저장/휴지통을 지원하면서도 상단 상태가 읽기 전용처럼 보이고, 내부 진단 문구와 가칭/프리셋 편집 UI가 기본 화면을 복잡하게 만들었다.
- 기대 동작: 상단에는 `별칭 @ IP`와 `연결됨 · INI 편집 가능` 같은 사용자 중심 상태만 표시한다. INI 전용 SFTP write capability check가 성공한 경우에만 저장/백업 복원/휴지통 이동/복구 작업을 활성화한다. 목록 metadata는 메모 중심으로 관리하며 displayName/presetSlot은 기본 UI에서 강제 편집하지 않는다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: clarify ini connection status and enable writable workflows`
- 처리 내용:
  - INI 전용 `iniFs:checkWriteCapability` IPC를 추가하고, `/media/fat/.hello-mister-backups/ini/.hello-mister-ini-write-check.tmp` 검사용 파일만 SFTP로 생성/검증/삭제한다.
  - 상단 작업 대상 영역을 `연결된 MiSTer`, `MiSTer 연결됨`, `INI 편집 가능/읽기만 가능/쓰기 확인 실패` 배지로 정리했다.
  - 기본 목록의 source badge를 `MiSTer에서 읽음`, `로컬`, `업로드 준비`, `원격 없음`, `캐시`로 바꿨다.
  - displayName/presetSlot 편집은 기본 목록에서 제거하고, 메모만 appData metadata에 즉시 저장하도록 정리했다.
  - 저장/복원/삭제/휴지통 작업은 INI write capability가 확인된 경우에만 활성화한다.

## BUG-026

- ID: BUG-026
- 화면: INI 설정
- 동작: INI 파일을 선택하고 가칭 이름, 프리셋, 메모, 백업, 휴지통을 관리한다.
- 문제: 기존 3분할 레이아웃에서 오른쪽 이름/프리셋/백업 패널이 편집 영역을 좁게 만들고, 휴지통 이동 후 원격 파일이 일반 목록에 캐시처럼 다시 보일 수 있었다.
- 기대 동작: 화면은 왼쪽 INI 목록과 오른쪽 GUI 편집기 2분할로 유지하고, 가칭 이름/프리셋/메모/백업/휴지통은 왼쪽 INI 목록 안에서 접거나 펼쳐 관리한다. 휴지통으로 이동한 원격 INI는 일반 목록에서 즉시 사라지고 휴지통 목록에서만 보인다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: simplify ini layout and consolidate backup trash lists`
- 처리 내용:
  - INI 설정 화면을 2분할 레이아웃으로 단순화하고 목록/편집기 사이 resizable splitter를 추가했다.
  - 기존 오른쪽 패널의 가칭 이름, 프리셋 슬롯, 메모 편집을 선택한 INI 목록 row 안으로 옮겼다.
  - 선택한 INI 백업 목록과 휴지통 목록을 왼쪽 목록 아래의 접이식 영역으로 통합했다.
  - 백업 삭제와 휴지통 영구 삭제는 INI 전용 백업/휴지통 경로 검증 IPC로만 수행한다.
  - 휴지통 이동 후 remote-only metadata가 cache 항목으로 일반 목록에 다시 섞이지 않게 했다.

## BUG-023

- ID: BUG-023
- 화면: INI 설정
- 동작: 주요 INI 항목의 `?` 도움말을 연다.
- 문제: 일부 핵심 INI key의 설명이 짧거나 직역처럼 보여서 사용자가 값의 의미, 사용 시점, 주의점을 빠르게 판단하기 어려웠다.
- 기대 동작: 주요 INI key 20개는 사람이 직접 정리한 자연스러운 한글 도움말을 우선 표시하고, 원본 INI 주석은 같은 팝업 안의 보조 정보로만 유지한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: improve Korean ini help copy`
- 처리 내용:
  - `key_menu_as_rgui`, `forced_scandoubler`, `vga_mode`, `ntsc_mode`, `composite_sync`, `vga_scaler`, `hdmi_audio_96k`, `keyrah_mode`, `vscale_mode`, `vscale_border`, `rbf_hide_datecode`, `menu_pal`, `hdmi_limited`, `direct_video`, `hdr`, `fb_size`, `fb_terminal`, `video_mode`, `refresh_min`, `refresh_max`의 catalog 문구를 보강했다.
  - 도움말 구조는 `설명`, `값 안내`, `추천`, `주의`, `원본 주석`으로 유지했다.
  - boolean 저장값 안내는 `OFF=0, ON=1로 저장됩니다.`로 통일했다.
  - INI 저장/백업/휴지통/원격 목록 새로고침 로직은 변경하지 않았다.

## BUG-022

- ID: BUG-022
- 화면: INI 설정
- 동작: catalog에 없는 INI 항목의 `?` 도움말을 연다.
- 문제: 이전 도움말은 출처/등급/확인 상태 같은 내부성 문구와 변경 방법 섹션을 함께 보여줘 사용자가 실제 설정 의미를 바로 읽기 어려웠다.
- 기대 동작: 도움말은 `설명`, `값 안내`, `추천`, `주의`, `원본 주석`만 보여준다. catalog 설명이 없고 원본 INI 주석이 있으면 주석을 한글 설명으로 보여주며, 원본 주석도 없는 경우에는 현재 값을 유지하라는 간단한 fallback을 표시한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: stop guessing undocumented ini option help`
- 처리 내용:
  - 도움말 popover 구조를 `설명`, `값 안내`, `추천`, `주의`, `원본 주석`으로 단순화했다.
  - catalog 설명이 없는 항목은 원본 INI 주석을 먼저 한글 설명으로 보여주고 원문은 하단에 표시한다.
  - 원본 주석도 없는 항목은 현재 INI에 포함된 설정이며 의미가 확실하지 않으면 기존 값을 유지하라는 안내만 표시한다.
  - INI 저장/백업/휴지통 로직은 변경하지 않았다.

## BUG-021

- ID: BUG-021
- 화면: INI 설정
- 동작: INI 항목의 `?` 도움말을 hover 또는 click으로 연다.
- 문제: 항목명/help 버튼의 native `title` tooltip과 새 자세한 custom popover가 동시에 표시되어 설명 팝업이 두 개 뜨는 것처럼 보였다.
- 기대 동작: 기존 첫 도움말 팝업 UI 하나만 사용하고, catalog 설명, fallback 설명, 값 안내, 추천/주의, 원본 주석을 같은 팝업 안에 통합한다. hover와 click은 같은 popover layer를 공유하며, click 고정 중에는 다른 hover popover가 동시에 뜨지 않는다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: merge duplicate ini help popovers`
- 처리 내용:
  - INI 항목명과 help icon의 `title` tooltip을 제거했다.
  - `pinnedHelpId`로 click 고정 도움말을 하나만 관리한다.
  - hover 도움말과 click 고정 도움말이 같은 `IniHelpPopover`를 사용한다.
  - 팝업 밖 click 또는 닫기 버튼으로 고정 팝업을 닫는다.
  - 도움말 클릭은 값 변경/dirty state를 유발하지 않도록 유지했다.

## BUG-020

- ID: BUG-020
- 화면: INI 설정
- 동작: catalog에 없는 INI 항목의 `?` 도움말을 열거나 ON/OFF 항목 row를 클릭한다.
- 문제: catalog fallback이 “원본 INI 주석을 참고하세요” 수준으로 약하고, 행/라벨/도움말 주변 클릭이 값 변경으로 이어질 수 있어 오조작 위험이 있었다.
- 기대 동작: catalog가 없어도 key 이름, 원본 주석, 현재 값 형식을 기반으로 보수적인 한국어 도움말을 표시하고, 값은 실제 checkbox/switch/select/input을 직접 조작할 때만 변경된다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: improve ini fallback help and toggle safety`
- 처리 내용:
  - catalog 미등록 key에 대해 영상/오디오/입력/메뉴/부팅/네트워크/기타 fallback profile을 생성한다.
  - 원본 leading/inline 주석이 있으면 한국어 추정 설명을 먼저 표시하고 원본 주석을 별도 섹션에 유지한다.
  - 원본 주석이 없는 항목도 간단한 설명, 값 안내, 권장/주의, 원본 정보 없음 안내를 표시한다.
  - INI row는 passive로 두고, checkbox/switch/select/text/number input만 값 변경을 일으키게 제한했다.
  - INI 저장/백업/휴지통/목록 새로고침/PC 가져오기 로직은 변경하지 않았다.

## BUG-019

- ID: BUG-019
- 화면: INI 설정
- 동작: 선택한 INI의 GUI 편집 항목을 이해하기 쉬운 라벨/도움말/입력 안내로 표시한다.
- 문제: INI key와 값 컨트롤만으로는 `composite_sync`, `direct_video`, `vga_mode` 같은 항목의 의미, 사용 시점, 허용값/범위, 저장값 의미를 파악하기 어려웠다.
- 기대 동작: 항목명은 `English Name (한국어 이름)` 형식으로 표시하고, 실제 key는 작은 보조 텍스트로 유지하며, `?` 도움말에서 한글 설명/사용 시점/입력값/권장/주의/원본 주석/저장값 정보를 확인할 수 있어야 한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: improve ini help popovers and labels`
- 처리 내용:
  - `iniHelpCatalog.ts`에 English/Korean label, 한글 설명, 사용 시점, 입력값 guide, 권장/주의, enum 후보, range, placeholder, 위험도를 추가했다.
  - INI parser가 catalog metadata를 `MisterIniSetting`에 연결하도록 보강했다.
  - INI 편집기 row는 `English (한국어)` 라벨, key 보조 텍스트, 위험 badge, hover/focus 도움말 popover를 표시한다.
  - `0`/`1` 값은 ON/OFF 토글을 유지하고, 도움말에는 `OFF=0, ON=1로 저장됩니다.`를 명시한다.
  - 숫자/텍스트 입력은 허용 범위/예시 placeholder와 hint를 표시하고, enum/select는 가능한 값과 한글 label을 함께 보여준다.
  - 저장/백업/휴지통/목록 새로고침/PC INI 가져오기 로직은 변경하지 않았다.

## BUG-018

- ID: BUG-018
- 화면: INI 설정
- 동작: 선택한 INI의 key/value 항목을 GUI로 편집한다.
- 문제: `key=0 ; comment` 형태의 줄 끝 주석이 값 입력칸에 섞여 들어가 0/1 토글로 표시되지 않고, 저장 시 주석 보존도 불명확했다.
- 기대 동작: 값과 줄 끝 주석을 분리해 입력 컨트롤에는 실제 값만 표시하고, `0`/`1`은 ON/OFF 토글로 보여주며, 원본 주석은 hover 도움말로 제공하고 저장 시 보존한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: render ini boolean values as toggles`

## BUG-017

- ID: BUG-017
- 화면: INI 설정
- 동작: 실제 MiSTer INI 목록 새로고침, PC INI 가져오기, GUI 값 편집
- 문제: 실제 `/media/fat`의 INI 파일이 일부 누락될 수 있고, PC에서 가져온 INI가 목록에 바로 보이지 않으며, 파일 출처와 0/1 값의 의미를 사용자가 파악하기 어려웠다.
- 기대 동작: `MiSTer.ini`, `MiSTer_alt_*.ini`, `MiSTer_*.ini`와 `.INI` 확장자를 빠짐없이 표시하고, remote/cache/local/import 상태를 구분하며, 0/1 값은 ON/OFF 토글과 한글 도움말로 보여준다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: clarify real ini sources and gui value controls`

## BUG-016

- ID: BUG-016
- 화면: INI 설정
- 동작: 연결된 MiSTer의 실제 INI 파일 목록을 읽고 GUI로 편집한다.
- 문제: 기존 INI 화면은 mock 프리셋/HDMI 보기/변경점 비교 중심이라 실제 `/media/fat` INI 목록, 파일별 백업, 휴지통, 가칭 이름, 프리셋 연동 흐름과 맞지 않았다.
- 기대 동작: `activeMisterProfile` 기준으로 `MiSTer.ini`, `MiSTer_alt_*.ini`, `MiSTer_*.ini`를 읽고, 저장 전 백업을 만든 뒤 INI 전용 허용 경로에만 쓰며, `MiSTer.ini` 삭제는 차단한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `feat: manage real mister ini files with gui editor`

한 번에 큰 기능 묶음을 처리하지 않고, 가능하면 한 작업에서 하나의 이슈 또는 하나의 사용자 흐름만 다룬다.

## 이슈 형식

- ID:
- 화면:
- 동작:
- 문제:
- 기대 동작:
- 우선순위:
- 상태:
- 관련 커밋:

## 현재 이슈

### BUG-001

- ID: BUG-001
- 화면: 스티커 제작 > 미스터 게임 리스트
- 동작: 미스터 게임 리스트를 연다.
- 문제: 메인 `MiSTer 연결` 메뉴가 있는데 미스터 게임 리스트 내부에도 중복 연결 항목이 보였다.
- 기대 동작: 미스터 게임 리스트는 active MiSTer만 사용하고, 연결되지 않았을 때만 `MiSTer 연결로 이동`을 보여준다.
- 우선순위: High
- 상태: 완료, manual QA 필요
- 관련 커밋: `7a29deb`

### BUG-002

- ID: BUG-002
- 화면: 카드 앨범
- 동작: 게임 실행을 클릭한다.
- 문제: Zaparoo 실행 실패 메시지가 오래된 실행 허용 설정명을 기준으로 안내했다.
- 기대 동작: 공식 설정명인 `[service] allow_run`을 기준으로 안내하고, 앱이 `config.toml`을 자동 수정하지 않는다는 점을 함께 표시한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `7a29deb`, `f0d50b4`

### BUG-003

- ID: BUG-003
- 화면: 미스터 게임 리스트 / 카드 앨범 실행 진단
- 동작: Zaparoo run 실패를 진단한다.
- 문제: 앱이 Zaparoo config를 읽어 `allow_run` 또는 `allowed_ips`가 관련됐는지 설명하지 못했다.
- 기대 동작: 앱이 `/media/fat/zaparoo/config.toml`을 read-only로 읽고 `allow_run` / `allowed_ips` 상태를 보고한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: diagnose zaparoo config and run failures`

### BUG-004

- ID: BUG-004
- 화면: 카드 앨범 / 미스터 게임 리스트 실행
- 동작: Zaparoo run 또는 `/run/` fallback으로 실행한다.
- 문제: 실행 실패가 API offline, run method 실패, fallback 실패, allow_run 누락/차단, allowed_ips 제한, 실행 경로 누락, media mismatch를 구분하지 못했다.
- 기대 동작: 실패 코드와 사용자 안내가 가장 가능성 높은 원인을 구분한다.
- 우선순위: Medium
- 상태: 완료
- 관련 커밋: `fix: diagnose zaparoo config and run failures`

## 다음 후보

### BUG-005

- ID: BUG-005
- 화면: 카드 앨범
- 동작: allow_run이 설정된 상태에서 카드를 실행한다.
- 문제: 생성된 ZapScript가 사용자의 allow_run 패턴과 맞는지 실제 장비 확인이 필요하다.
- 기대 동작: 실행이 성공하거나, 정확한 ZapScript와 추천 패턴을 표시한다.
- 우선순위: High
- 상태: 대기
- 관련 커밋: 없음

### BUG-006

- ID: BUG-006
- 화면: NFC 관리
- 동작: Zaparoo readers.write로 카드를 쓴다.
- 문제: 실제 NFC 리더 QA가 필요하다.
- 기대 동작: 리더 목록, 쓰기 확인, 성공/실패가 명확히 표시된다.
- 우선순위: Medium
- 상태: 대기
- 관련 커밋: 없음

### BUG-007

- ID: BUG-007
- 화면: 미스터 게임 리스트 / Zaparoo 진단
- 동작: allow_run 또는 allowed_ips가 비어 있을 때 추천 설정을 적용한다.
- 문제: 사용자가 config.toml을 수동 편집해야 해서 카드 앨범 실행 복구가 어렵다.
- 기대 동작: 앱이 변경점 미리보기, 백업, 제한된 SFTP write, settings.reload, 재진단 안내를 제공한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: feat: add safe zaparoo config apply wizard

### BUG-008

- ID: BUG-008
- 화면: NFC 관리
- 동작: Zaparoo readers.write로 NFC 태그 쓰기 준비 상태를 판단한다.
- 문제: Zaparoo API와 reader가 연결되어 있고 payload가 valid인데도 SSH session id가 없다는 이유로 "활성 MiSTer 연결 세션이 없습니다" 메시지가 표시될 수 있었다.
- 기대 동작: active MiSTer profile, Zaparoo API 연결, reader 1개 이상, valid payload이면 태그 쓰기 버튼을 활성화한다. SSH session 없음만으로 NFC 쓰기를 막지 않는다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: fix: use active mister profile for nfc write readiness

### BUG-009

- ID: BUG-009
- 화면: NFC 관리
- 동작: 태그 읽기 / 쓰기 후 검증
- 문제: NFC 쓰기는 성공하지만 태그 읽기/검증이 Zaparoo token event가 아니라 기존 read 흐름을 타면서 오류가 남.
- 기대 동작: `/api/v0.1/events`의 `tokens.added` 이벤트를 기다리고, 읽은 text를 현재 payload와 비교해 검증 성공/불일치/timeout을 표시한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: read nfc tags through zaparoo token events`

### BUG-010

- ID: BUG-010
- 화면: 스티커 제작 > 미스터 게임 리스트 > 게임 리스트 동기화
- 동작: 연결된 MiSTer 스캔
- 문제: v2 MiSTer 연결과 active profile은 살아 있지만 v1 Library Sync가 별도 bridge session만 요구해 "활성 브리지 세션" 오류로 스캔을 막았다.
- 기대 동작: Library Sync는 v2 activeMisterProfile을 기준으로 Electron main active profile을 hydrate하고, 기존 read-only SSH/SFTP IPC로 `/media/fat/games` 1단계 폴더와 파일을 스캔한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: use active mister profile for library sync scan`

### BUG-011

- ID: BUG-011
- 화면: 스티커 제작 > 미스터 게임 리스트 > 게임 리스트 동기화
- 동작: 연결된 MiSTer 스캔 후 가져올 플랫폼과 새 플랫폼 발견 목록을 확인한다.
- 문제: “A. 가져올 플랫폼”이 기본 전체 선택처럼 표시되고, “B. 새 플랫폼 발견”에 이미 기존 게임 리스트에 있는 플랫폼까지 표시된다.
- 기대 동작: 새 scan/import session은 모든 플랫폼을 기본 제외로 시작하고, 새 플랫폼 발견은 기존 게임 리스트 플랫폼을 normalized key로 제외한 새 플랫폼만 보여준다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: default library import unchecked and filter existing platforms`

### BUG-012

- ID: BUG-012
- 화면: MiSTer 게임 롬 관리
- 동작: 앱 안에서 MiSTer ROM 파일을 탐색하고 PC/MiSTer 간 파일 작업을 수행한다.
- 문제: 기존 화면은 복사 전 확인 중심이라 Windows 탐색기나 네트워크 드라이브 없이 실제 ROM 파일을 관리하기 어려웠다.
- 기대 동작: `/media/fat/games`와 `/media/fat/_Arcade` 아래에서만 PC -> MiSTer 복사, MiSTer -> PC 복사, MiSTer -> MiSTer 복사, 이동, 이름 변경, 휴지통 이동, 새 폴더 작업을 수행한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `feat: add explorer style mister rom file manager`

### BUG-013

- ID: BUG-013
- 화면: MiSTer 게임 롬 관리
- 동작: ROM 관리 화면에서 PC 파일을 선택하고 MiSTer 대상 폴더로 보내거나, MiSTer 파일을 PC 폴더로 보낸다.
- 문제: 탐색기 UI는 추가되었지만 상태가 읽기 전용으로만 보이고, “롬 추가”가 PC 파일 선택 dialog로 이어지지 않아 실제 양방향 복사 흐름을 시작하기 어려웠다.
- 기대 동작: ROM 관리 전용 capability check로 읽기/쓰기 가능 여부를 표시하고, PC 파일 패널과 MiSTer 파일 패널에서 선택한 파일을 “MiSTer로 보내기” 또는 “PC로 보내기”로 복사한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: enable local pc explorer and bidirectional rom transfers`

### BUG-014

- ID: BUG-014
- 화면: MiSTer 게임 롬 관리
- 동작: ROM 파일 탐색기에서 연결 상태, PC/MiSTer 파일 목록, 보내기 흐름을 확인한다.
- 문제: 상단에는 읽기 전용 연결처럼 보이고 내부 탐색기에는 읽기/쓰기 가능으로 보여 상태가 충돌했다. MiSTer 별칭/IP가 중복되어 깨져 보였고, 버튼과 긴 파일명이 탐색기처럼 읽히지 않았으며 내부 `.hello-mister-rw-check` 폴더가 목록에 노출되었다.
- 기대 동작: ROM 관리 화면은 “MiSTer 연결됨 · ROM 폴더 읽기/쓰기 가능”처럼 capability 기준으로 표시하고, 별칭/IP는 `alias @ ip` 형식으로 한 번만 보여준다. 내부 점검/휴지통 폴더는 기본 숨김 처리하고, 파일명은 ellipsis와 tooltip으로 읽기 쉽게 표시한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: polish rom explorer status and file list layout`

### BUG-015

- ID: BUG-015
- 화면: MiSTer 게임 롬 관리
- 동작: PC/MiSTer ROM 파일을 2분할 탐색기에서 선택하고 복사한다.
- 문제: 파일명이 좁게 잘리고 수정일/설명/오른쪽 패널이 공간을 많이 차지해 탐색기처럼 사용하기 어려웠다. 다중 선택, 드래그 선택, 드래그 복사, 우클릭 작업 메뉴도 부족했다.
- 기대 동작: PC와 MiSTer 파일 목록을 좌우 2분할로 크게 보여주고, 이름/확장자/크기 중심의 compact 목록에서 Ctrl/Shift 다중 선택, 드래그 선택, PC↔MiSTer 드래그 복사, 우클릭 메뉴를 사용할 수 있어야 한다. 작업 로그는 기본 화면이 아니라 작업 보기 패널에서 확인한다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: refine rom explorer two pane interactions`

## 실제 앱 검증 완료 기록

검증일: 2026-06-01
기준 커밋: `01e0b8b fix: refine rom explorer two pane interactions`

다음 항목은 실제 앱 검증에서 동작 완료로 확인했다.

- 게임 리스트 동기화: 연결된 MiSTer 기준 스캔과 가져오기 흐름 확인 완료.
- 새 플랫폼 발견 필터: 기존 게임 리스트에 있는 플랫폼은 새 플랫폼 발견 목록에서 제외됨.
- 가져올 플랫폼 기본 체크 해제: 새 scan/import session의 기본값은 모두 제외이며 사용자가 선택한 플랫폼만 가져옴.
- 게임 리스트에서 카드 만들기: 게임 리스트 항목에서 카드 생성 흐름으로 연결됨.
- 카드 앨범 실행: Zaparoo 실행 bridge를 통해 실행 시도 및 실패 원인 안내 흐름 확인 완료.
- NFC 관리/직접 쓰기: 게임 리스트는 선택 게임 payload를 NFC 관리 화면으로 전달하고, 카드 앨범 NFC 아이콘은 현재 카드 payload를 직접 Zaparoo `readers.write`에 보냄.
- NFC 쓰기/읽기 검증: `readers.write` 쓰기와 `tokens.added` 이벤트 기반 읽기/검증 흐름 확인 완료.
- ROM 탐색기 양방향 복사: PC -> MiSTer, MiSTer -> PC 복사 동작 확인 완료.

남은 주의 사항:

- Zaparoo 실행 성공 여부는 MiSTer의 Zaparoo `allow_run` 설정과 실제 ZapScript 패턴에 영향을 받는다.
- ROM 탐색기 write 범위는 계속 `/media/fat/games`와 `/media/fat/_Arcade` 아래로 제한한다.
- raw command IPC, unrestricted remote write IPC, password 평문 저장은 계속 금지한다.
### BUG-016

- ID: BUG-016
- 화면: INI 설정
- 동작: `INI 목록 새로고침`을 누르면 현재 active MiSTer의 `/media/fat` 루트에서 실제 INI 파일 목록을 다시 읽는다.
- 문제: 원격 SFTP listing에서 파일 타입 메타데이터가 없거나 `MiSTer_alt_*.ini` 필터가 좁으면 실제 MiSTer에 있는 INI가 목록에서 누락될 수 있었다.
- 기대 동작: `MiSTer.ini`, `MiSTer.INI`, `MiSTer_alt_*.ini`, `MiSTer_*.ini`가 모두 표시되고, 원격 파일은 cache/metadata보다 우선한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: reliably refresh remote mister ini list`
- 처리 내용:
  - `/media/fat` raw listing을 기준으로 원격 INI 후보를 다시 만든다.
  - 디렉터리는 제외하되, 파일 metadata 조회가 불완전해도 유효한 `MiSTer*.ini` 파일명은 목록에 표시한다.
  - 원격 파일은 항상 `source=remote`로 표시하고, appData metadata는 displayName/presetSlot/notes만 병합한다.
  - cache에만 있는 항목은 원격 항목을 숨기지 않도록 별도 source로 구분한다.
  - 개발자 모드에서 raw listing count, filtered INI count, metadata/cache/final count, excluded reason summary를 확인할 수 있다.

### BUG-023

- ID: BUG-023
- 화면: 전체 사이드바 / 앱 모드
- 동작: 앱 모드를 선택하고 메뉴를 탐색한다.
- 문제: 기존 `basic / advanced / developer` 3단계 구조가 사용자에게 과하게 복잡하고, 개발자 도구 메뉴가 직접 노출되어 기본 흐름을 흐렸다.
- 기대 동작: 사용자 노출 모드는 `기본 / 고급` 두 가지로 줄이고, 기존 developer 저장값은 advanced로 마이그레이션한다. appData, IPC, 로그, 리포트, 정책 같은 내부 진단은 고급 모드의 접힌 섹션으로 이동한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: collapse sticker navigation and reduce app modes`

### BUG-024

- ID: BUG-024
- 화면: 왼쪽 사이드바 > 스티커 제작
- 동작: 스티커 제작 parent 메뉴를 클릭한다.
- 문제: 스티커 제작 parent가 라우팅 항목처럼 동작하면 `/stickers` 계열 진입이 불필요하게 발생하고, 사용자는 하위 메뉴를 펼치는 동작과 화면 이동을 구분하기 어렵다.
- 기대 동작: 스티커 제작 parent는 expand/collapse만 수행한다. 기본 시작 시 접혀 있고, `/stickers/...` route에서는 자동으로 펼쳐진다. 하위 메뉴 클릭만 실제 v1 feature route로 이동한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: collapse sticker navigation and reduce app modes`

### BUG-025

- ID: BUG-025
- 화면: INI 설정
- 동작: 선택한 INI의 백업 목록을 확인하고, 백업을 미리본 뒤 복원하거나 휴지통으로 이동한 INI를 복구한다.
- 문제: INI 저장 시 백업은 생성되지만 UI에서 백업 내용을 미리 확인하기 어렵고, 휴지통 목록/복구 흐름이 실제 사용 기준으로 충분히 드러나지 않았다.
- 기대 동작: INI별 백업 목록, 백업 미리보기, 복원 전 덮어쓰기 경고, 복원 전 현재 파일 재백업, 휴지통 목록, 휴지통 복구가 앱 안에서 가능해야 한다. `MiSTer.ini` 삭제는 차단하고, 영구 삭제/휴지통 비우기는 이번 단계에서 비활성으로 둔다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `feat: enable ini backup restore and trash workflows`
- 처리 내용:
  - INI 백업 파일은 해당 INI의 백업 폴더 안에서만 read-only 미리보기를 허용한다.
  - 백업 복원 시 현재 원격 INI가 덮어써진다는 경고를 표시하고, 적용 전 현재 파일을 다시 백업한다.
  - 휴지통 목록 새로고침과 복구 흐름을 화면에 노출했다.
  - 휴지통 비우기/영구 삭제는 비활성으로 유지했다.
  - raw command IPC와 unrestricted remote write IPC는 추가하지 않았다.
### BUG-037

- ID: BUG-037
- 화면: 스티커 제작 > 미스터 게임 리스트 > 게임 리스트 동기화
- 동작: MiSTer의 `/media/fat/_Arcade/PGM` 같은 폴더 기반 게임 목록을 스캔한다.
- 문제: PGM처럼 공식 기본 플랫폼 catalog에 없는 폴더가 새 플랫폼으로 올바르게 등록되지 못하거나, 가져오기 플랫폼 목록에 자동으로 섞일 수 있었다.
- 기대 동작: 새로 발견된 폴더는 먼저 사용자 정의 플랫폼으로 등록하거나 분류 폴더로 표시해야 한다. 등록 후에도 가져오기 기본값은 체크 해제이며, 사용자가 직접 선택한 플랫폼만 가져온다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `feat: support custom platforms in game list sync`
- 처리 내용:
  - PGM / IGS PGM / PolyGame Master alias를 같은 플랫폼으로 정규화한다.
  - `/media/fat/_Arcade/PGM` 스캔 결과를 `Arcade/PGM` 플랫폼 후보로 분리한다.
  - 사용자 정의 플랫폼 catalog에 display name, aliases, source root, extensions, parent system, card category를 저장한다.
  - 플랫폼이 아닌 폴더는 classification-only로 저장해 새 플랫폼 발견 목록에서 제외한다.
  - 미등록 scan-only 플랫폼은 A. 가져올 플랫폼 목록에 자동 추가하지 않는다.
  - raw command IPC, generic remote write IPC, password 평문 저장은 추가하지 않았다.
### BUG-038

- ID: BUG-038
- 화면: 스티커 제작 > 미스터 게임 리스트 > 게임 리스트 동기화
- 동작: 연결된 MiSTer에서 게임 리스트를 스캔한다.
- 문제: read-only scan bridge가 실제로는 `/media/fat/games` 1단계 core 폴더만 읽어서 `/media/fat/_Arcade` 루트의 `.mra` 파일과 `/media/fat/_Arcade/PGM` 같은 1단계 하위 폴더 게임이 게임 리스트 동기화에 들어오지 않았다.
- 기대 동작: 게임 리스트 동기화는 `/media/fat/games`와 `/media/fat/_Arcade`를 모두 스캔한다. `_Arcade` 루트 `.mra`는 `Arcade` 항목으로, `_Arcade/<folder>`의 `.mra`, `.zip`, `.rom` 및 기존 허용 확장자 파일은 해당 folder 기반 custom platform 후보로 표시한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: scan arcade root in game list sync`
- 처리 내용:
  - Electron read-only listing에서 `/media/fat/_Arcade` root와 `/media/fat/_Arcade/<FOLDER>` 1단계 하위 폴더 조회를 허용했다.
  - `listRemoteGames`가 `/media/fat/games` core folders와 `_Arcade` root/subfolders를 함께 scan folder로 반환하게 했다.
  - v1 sticker bridge scan summary/root status를 `/media/fat/games`, `/media/fat/_Arcade` 두 root 기준으로 표시한다.
  - 가져올 플랫폼 기본 unchecked 정책과 기존 플랫폼 제외/new platform discovery 정책은 유지했다.
  - raw command IPC, generic remote write IPC, ROM copy/upload, password 평문 저장은 추가하지 않았다.

### BUG-039

- ID: BUG-039
- 화면: 스티커 제작 > 미스터 게임 리스트 > 게임 리스트 동기화
- 동작: `_Arcade` 하위 폴더를 커스텀 플랫폼으로 등록한다.
- 문제: `PGM` 같은 비공식/사용자 분류 폴더를 커스텀 플랫폼으로 등록해도 등록 직후 해당 source root의 게임이 미스터 게임 리스트 라이브러리에 병합되지 않아 카드 만들기, 실행, NFC 흐름까지 바로 이어지지 않았다.
- 기대 동작: 사용자가 `_Arcade/<folder>`를 커스텀 플랫폼으로 등록하면 appData-backed custom platform catalog에 저장하고, 해당 source root의 지원 확장자 게임을 미스터 게임 리스트에 즉시 병합한다. 동일한 absolute MiSTer path는 중복 추가하지 않는다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `feat: add custom arcade platform registration`
- 처리 내용:
  - 커스텀 플랫폼 등록 시 sourceRoot와 확장자 후보를 기준으로 현재 scan entries를 추출한다.
  - 추출된 entry의 platform/system 표시를 등록한 커스텀 플랫폼 이름으로 맞춘다.
  - 기존 라이브러리에 같은 absolute path가 있으면 중복으로 건너뛴다.
  - 새 entry는 기존 MiSTer game list entries와 합쳐서 병합하고, 등록된 플랫폼 화면으로 이동한다.
  - 등록된 커스텀 플랫폼과 classification-only/ignored 폴더는 다음 새 플랫폼 발견 목록에서 제외한다.
  - raw command IPC, generic remote write IPC, ROM 탐색기 파일 작업, password 평문 저장은 추가하지 않았다.
### BUG-040

- ID: BUG-040
- 화면: 스티커 제작 > 미스터 게임 리스트 > 게임 리스트 동기화
- 동작: `/media/fat/_Arcade/PGM` 같은 폴더를 사용자가 커스텀 플랫폼으로 직접 만든다.
- 문제: 이전 커스텀 플랫폼 등록 흐름은 새 플랫폼 발견 row에 묶여 있었고, 등록과 라이브러리 병합이 한 번에 처리되어 사용자가 병합 시점을 명확히 선택하기 어려웠다.
- 기대 동작: 사용자는 플랫폼 이름, 상위 시스템, 게임 폴더, 선택 core 폴더, 확장자, 카드 카테고리, launch format을 입력해 커스텀 플랫폼을 등록한다. 등록은 catalog/config 저장만 수행하고, `라이브러리에 병합` 버튼을 눌렀을 때만 현재 scan entry를 게임 리스트에 추가한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `feat: create custom platforms from arcade folders`
- 처리 내용:
  - `커스텀 플랫폼 만들기` 섹션을 게임 리스트 동기화 화면에 추가했다.
  - 기본값은 PGM / Arcade / `/media/fat/_Arcade/PGM` / `/media/fat/_Arcade/cores` / `.mra` / `**launch:{misterPath}`로 설정했다.
  - 커스텀 플랫폼 catalog에 `coreRoot`와 `launchTemplate` metadata를 저장할 수 있게 했다.
  - 등록과 병합을 분리하여 등록 직후 자동 병합하지 않는다.
  - 명시 병합 시 같은 absolute MiSTer path는 중복으로 추가하지 않는다.
  - 등록된 sourceRoot는 platform identity에 포함되어 새 플랫폼 발견에서 다시 뜨지 않도록 기존 normalization 흐름을 유지한다.
  - raw command IPC, generic remote write IPC, ROM 탐색기 파일 작업, password 평문 저장은 추가하지 않았다.

### BUG-041

- ID: BUG-041
- 화면: 스티커 제작 > 미스터 게임 리스트 > 게임 리스트 동기화 > 커스텀 플랫폼
- 동작: `/media/fat/_Arcade/PGM` 같은 custom sourceRoot를 스캔한다.
- 문제: 실제 파일 구조가 `/media/fat/_Arcade/PGM/<게임명 폴더>/<게임>.mra`일 때 기존 스캔이 sourceRoot 바로 아래 파일만 읽어서 후보가 0개로 표시됐다.
- 기대 동작: custom platform config가 `scanDepth`를 저장하고 기본 2단계 스캔으로 sourceRoot 하위 게임 폴더 안의 `.mra` 파일까지 후보로 표시한다. 전체 재귀 스캔은 명시 옵션으로만 허용한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: scan nested folders for custom platforms`
- 처리 내용:
  - custom platform catalog와 등록 draft에 `scanDepth` / `recursive` 옵션을 추가했다.
  - 기본값은 `scanDepth: 2`, `recursive: false`로 설정했다.
  - Electron read-only SFTP folder listing은 옵션으로 1/2/3단계 또는 명시 recursive 스캔을 지원하되 max file count guard를 유지한다.
  - `_Arcade/<folder>` scan은 기본 2단계로 실행해 `/PGM/<게임명 폴더>/<게임>.mra`를 찾는다.
  - 커스텀 플랫폼 후보 필터는 sourceRoot 포함 여부뿐 아니라 sourceRoot 기준 상대 깊이도 확인한다.
  - `game.mra` 같은 일반 파일명은 부모 폴더명을 게임명 fallback으로 사용한다.
  - raw command IPC, remote write IPC, ROM 탐색기 파일 작업, password 평문 저장은 추가하지 않았다.

### BUG-042

- ID: BUG-042
- 화면: 스티커 제작 > 미스터 게임 리스트 > 게임 리스트 동기화 > 커스텀 플랫폼
- 동작: `/media/fat/_Arcade/PGM` sourceRoot를 등록한 뒤 PGM 후보를 스캔하고 라이브러리에 병합한다.
- 문제: `scanDepth` 옵션은 생겼지만 후보 계산이 기존 `lastScanEntries` 필터에만 의존해서, 이전 전체 스캔에 `/media/fat/_Arcade/PGM/<게임명 폴더>/<게임>.mra`가 들어오지 않은 경우 후보가 계속 0개였다. 또한 일반 import classification 필터가 커스텀 sourceRoot 후보를 다시 제외할 수 있었다.
- 기대 동작: 후보가 0개이면 등록된 sourceRoot를 read-only SFTP로 직접 스캔하고, sourceRoot/확장자/scanDepth 기준으로만 후보를 만든다. 후보가 없으면 raw 파일 수, 제외 수, sourceRoot별 메시지로 원인을 보여준다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: find nested mra files for custom platforms`
- 처리 내용:
  - `scanCustomPlatformSource`를 추가해 registered sourceRoot를 직접 read-only 스캔한다.
  - PGM 기본 구조인 `/media/fat/_Arcade/PGM/<게임명 폴더>/<게임>.mra`를 기존 전체 스캔 캐시에 의존하지 않고 찾을 수 있게 했다.
  - 커스텀 후보는 일반 import classification 필터 대신 sourceRoot, 확장자, scanDepth 기준으로 계산한다.
  - 후보 0개일 때 sourceRoot 직접 스캔을 먼저 시도하고 진단 메시지를 표시한다.
  - raw command IPC, remote write IPC, unrestricted scan, ROM 탐색기 파일 작업은 추가하지 않았다.

### BUG-043

- ID: BUG-043
- 화면: 스티커 제작 > 미스터 게임 리스트 > 게임 리스트 동기화 > 커스텀 플랫폼
- 동작: `/media/fat/_Arcade/PGM` 같은 custom sourceRoot를 스캔하고 후보 수를 확인한다.
- 문제: PGM 커스텀 플랫폼 스캔 후보가 11개만 표시될 때 전체 파일 수, MRA 파일 수, 확장자 제외, 깊이 제한, 중복 제외 같은 이유가 분리되어 보이지 않아 사용자가 왜 11개인지 알 수 없었다.
- 기대 동작: 스캔 결과는 전체 발견 파일 수와 최종 게임 후보 수를 분리해서 표시하고, `.mra` 후보 수, 기타 확장자 제외 수, 중복 full path 제외 수, 깊이 제한 폴더 수, 실패 폴더 수를 보여준다. 후보 단계 중복 제거는 `fullMiSTerPath` 기준으로만 수행한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: explain and correct custom platform candidate counts`
- 처리 내용:
  - custom platform 직접 sourceRoot 스캔에 상세 진단 통계를 추가했다.
  - `.MRA`/`.mra` 파일 수와 확장자 필터 제외 수를 따로 집계한다.
  - 확장자 제외, 폴더/숨김 제외, 깊이 제한, 읽기 실패, 중복 full path 제외 이유를 reason summary로 표시한다.
  - 후보 dedupe는 같은 full MiSTer path에만 적용하고, 같은 title/platform만으로 후보를 제거하지 않는다.
  - MRA 기반 아케이드에서는 `.mra`를 게임 후보로 보고 `.zip` ROM 묶음은 기본 후보에서 제외한다는 설명을 UI/README에 기록했다.
  - raw command IPC, remote write IPC, ROM 탐색기 파일 작업, password 평문 저장은 추가하지 않았다.

### BUG-044

- ID: BUG-044
- 화면: 스티커 제작 > 미스터 게임 리스트 > 게임 리스트 동기화 > 커스텀 플랫폼
- 동작: `.mra` 확장자를 사용하는 PGM 같은 custom sourceRoot를 스캔한다.
- 문제: 전체 파일 32개, MRA 파일 32개, 확장자 필터 통과 32개인 상태에서도 21개가 `unsupportedFile`로 분류되어 최종 후보가 11개만 표시됐다. 커스텀 플랫폼에서는 MRA 파싱 실패, core 확인 실패, metadata 없음, 공식 플랫폼 registry 없음이 후보 제외 사유가 아니어야 한다.
- 기대 동작: custom platform extensions에 `.mra`가 포함되어 있으면 scanDepth 안의 모든 `.mra` 파일이 후보가 된다. 후보 단계에서는 같은 `fullMiSTerPath`만 중복 제외하고, 같은 title/platform/폴더명만으로 제외하지 않는다. 검증 불완전 항목은 경고/status로 남긴다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: include all mra files as custom platform candidates`
- 처리 내용:
  - `scanCustomPlatformSource`가 확장자 통과 파일을 일반 MiSTer path parser로 다시 걸러내지 않게 했다.
  - custom platform 후보는 sourceRoot, extensions, scanDepth, full path 중복 기준으로 직접 생성한다.
  - `.MRA`/`.mra`는 모두 후보로 포함되며, MRA/core/metadata 확인 실패는 후보 제외가 아니라 `classificationReason` 경고성 상태로 남긴다.
  - `game.mra`, `default.mra`, `index.mra`, `rom.mra` 같은 일반 파일명은 부모 폴더명을 게임 제목 fallback으로 사용한다.
  - 병합 대상도 모든 custom 후보를 표시하고, 기존 라이브러리와 같은 `fullMiSTerPath`만 중복으로 건너뛴다.
  - raw command IPC, remote write IPC, ROM 탐색기 파일 작업, password 평문 저장은 추가하지 않았다.

### BUG-045

- ID: BUG-045
- 화면: 스티커 제작 사이드바 / 카드편집
- 동작: 스티커 제작 메뉴를 정리하고, 기존 카드를 편집하면서 템플릿을 바꾼다.
- 문제: 사용자 메뉴에 더 이상 쓰지 않는 `프로젝트 게임` 항목이 남아 있었고, `/stickers/editor`가 `작업 카드`로 표시되었다. 또한 기존 카드에서 템플릿을 바꾸면 Main Image/Clear Logo 위치, 확대, crop, fit mode 같은 이미지 transform이 새 템플릿 기본값으로 초기화될 수 있었다.
- 기대 동작: `프로젝트 게임`은 사이드바에서 제거하고 legacy route만 유지한다. `/stickers/editor`는 `카드편집`으로 표시한다. 템플릿 변경은 배경/layout/slot 구조만 바꾸고 기존 이미지 transform은 새 템플릿의 대응 이미지 slot으로 보존한다. 새로 batch 매칭된 이미지만 v1 center zoom 기본값을 적용한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: preserve card image transforms and simplify sticker menu`
- 처리 내용:
  - v2 Sticker Production sidebar에서 `/stickers/project-games` child menu를 제거했다.
  - `/stickers/editor` user-facing label을 `카드편집`으로 바꿨다.
  - `/stickers/project-games` route는 기존 링크 호환을 위해 `/stickers/mister` redirect로 유지했다.
  - 카드 템플릿 변경 시 기존 main/logo image slot override를 같은 layer id, 이전 템플릿 image layer, slot fallback 순서로 찾아 새 템플릿의 image slot에 매핑한다.
  - 보존 대상은 x/y, scale, width/height, crop, rotation, fit mode 등 SlotOverride 기반 이미지 transform이다.
  - batch image matching은 기존 v1 `mainImageDefaultCenteredZoomSteps = 25` 기준의 centered zoom을 새로 매칭된 main image에만 적용한다.
  - MiSTer 연결, ROM 탐색기, INI, Zaparoo, NFC, raw command IPC, remote write 범위는 변경하지 않았다.

### BUG-046

- ID: BUG-046
- 화면: 스티커 제작 > 카드편집
- 동작: 이미지 일괄 매칭을 실행한다.
- 문제: 이미지가 매칭되더라도 기존 v1의 중앙확대 25회 결과가 새 main image transform에 적용되지 않을 수 있었다. 특히 템플릿 layer에 저장 transform이 있으면 새로 매칭한 이미지도 card-level override 없이 표시될 수 있었다.
- 기대 동작: 새로 매칭된 main image에는 수동 중앙확대 버튼 25회와 같은 `mainImageDefaultCenteredZoomSteps = 25` centered zoom transform을 적용한다. 이미 같은 이미지가 들어 있는 카드의 기존 수동 transform은 덮어쓰지 않는다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: apply center zoom after batch image matching`
- 처리 내용:
  - 이미지 일괄 매칭 전용 fit helper가 템플릿 저장 transform 때문에 default center zoom을 건너뛰지 않도록 `forceDefaultMainZoom`을 적용했다.
  - 같은 image id/cache key가 이미 카드에 있으면 기존 slot override를 보존해 수동 조정 transform을 덮어쓰지 않게 했다.
  - 새로 매칭된 main image에만 `DEFAULT_BATCH_IMAGE_CENTER_ZOOM_STEPS` 25회 centered zoom override를 저장한다.
  - 개발 환경에서 batch match 적용 여부, 적용 step 수, before/after transform을 확인할 수 있는 diagnostics를 남긴다.
  - MiSTer, ROM, INI, Zaparoo, NFC 기능은 변경하지 않았다.

### BUG-047

- ID: BUG-047
- 화면: MiSTer FPGA > 컨트롤러 관리
- 동작: 연결된 MiSTer 기준으로 컨트롤러 관련 설정 파일을 확인하고 백업/복원한다.
- 문제: 컨트롤러 관리 화면이 placeholder라 실제 MiSTer 파일 기반 inventory, read-only 내용 보기, 백업/복원 구조가 없었다.
- 기대 동작: active MiSTer의 컨트롤러 관련 후보 경로를 read-only SFTP로 제한 스캔하고, 후보 파일 내용 보기와 컨트롤러 전용 백업/복원 adapter를 제공한다. raw command나 임의 SSH command는 사용하지 않는다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `feat: add controller settings inventory and backups`
- 처리 내용:
  - `/controllers` 화면을 실제 컨트롤러 관리 화면으로 교체했다.
  - `/media/fat`, `/media/fat/config`, config 하위 input/controller/joystick/gamecontrollerdb 후보 폴더, `/media/fat/Scripts`를 제한 깊이 read-only로 스캔한다.
  - `gamecontrollerdb*`, `*controller*`, `*joystick*`, `*input*`, `*.map`, `*.cfg`, `*.ini`, `*.txt` 후보 파일을 분류해서 표시한다.
  - 파일 내용 보기는 read-only로만 제공한다.
  - 원격 백업은 `/media/fat/.hello-mister-backups/controllers/**`로 제한하고, 가능한 경우 appData 로컬 백업도 함께 만든다.
  - 복원은 `/media/fat/config/**` 아래 컨트롤러 관련 파일에만 허용하며, 복원 전 현재 파일을 다시 백업한다.
  - NeoGeo 4버튼, CPS 6버튼, Console Pad 프리셋 구조는 준비하되 실제 적용은 파일 구조 확인 전까지 비활성화했다.
  - raw command IPC, 임의 SSH command, unrestricted remote write, ROM/INI/Zaparoo/NFC 기능은 변경하지 않았다.

### BUG-048

- ID: BUG-048
- 화면: MiSTer FPGA > MiSTer 게임 롬 관리
- 동작: PC 폴더 트리와 PC/MiSTer 파일 목록을 사용해 ROM 파일을 탐색하고 드래그 복사한다.
- 문제: PC 드라이브/폴더 경로를 클릭해도 트리 확장이 직관적이지 않았고, 트리 영역 스크롤과 마우스 위치 기준 뒤로가기, 특정 폴더 대상 드래그 복사 흐름이 부족했다.
- 기대 동작: PC 트리 행 클릭 시 폴더를 열고 트리를 확장한다. 트리 창은 내부 스크롤된다. `Backspace` 또는 `Alt+Left`는 마우스가 올라간 PC/MiSTer 패널의 이전 폴더로 이동한다. PC 파일은 MiSTer 폴더 행으로, MiSTer 파일은 PC 트리/폴더 행으로 드래그해 복사할 수 있다.
- 우선순위: Medium
- 상태: 완료
- 관련 커밋: `fix: improve rom explorer tree navigation and drag copy`
- 처리 내용:
  - PC 트리 행 클릭을 `openLocalTreeNode`로 통합해 폴더 열기와 트리 확장을 함께 수행한다.
  - PC 트리 영역을 자체 스크롤 창으로 고정했다.
  - 패널 hover 상태와 local/remote folder history를 사용해 `Backspace`, `Alt+Left` 뒤로가기를 구현했다.
  - 폴더 행/트리 행 drop target을 추가해 기존 ROM manager copy adapter로 folder-specific drag copy를 연결했다.
  - raw command IPC, unrestricted remote write IPC, password 평문 저장, 허용 root 밖 MiSTer write는 추가하지 않았다.
### BUG-049

- ID: BUG-049
- 화면: MiSTer FPGA > MiSTer 게임 롬 관리
- 동작: PC와 MiSTer 사이에서 파일을 탐색하고 전송한다.
- 문제: 화면이 ROM root 전용 탐색기 구조로 남아 있어 MiSTer 빠른 폴더 선택이 전체 화면 위에 따로 보였고, `/media/fat/games`와 `/media/fat/_Arcade` 밖의 폴더를 열거나 휴지통 폴더를 확인하기 어려웠다.
- 기대 동작: 이 화면은 ROM 파일 전용이 아니라 PC / MiSTer 파일 전송 관리자로 동작한다. MiSTer 빠른 위치 선택은 MiSTer 파일 창 위에 있고, MiSTer 절대경로를 SFTP로 탐색/전송할 수 있다.
- 우선순위: High
- 상태: 완료, 실제 장비 수동 QA 필요
- 관련 커밋: `fix: broaden mister file transfer manager access`
- 처리 내용:
  - MiSTer 빠른 위치 버튼을 MiSTer 파일 패널 상단으로 이동했다.
  - 원격 경로 검증을 ROM root 제한에서 MiSTer 절대경로 검증으로 변경했다.
  - `..`, Windows 경로 구분자, null byte, symlink 경로 차단은 유지했다.
  - 현재 MiSTer 폴더 기준 `.hello-mister-trash`를 열 수 있게 해 휴지통 보기를 파일 전송 흐름에 맞췄다.
  - 연결된 MiSTer에서는 별도 temp 파일 권한 확인 실패로 쓰기 버튼을 막지 않고, SFTP 작업을 실행한 뒤 실제 파일시스템 거부를 작업 결과로 표시한다.
  - raw command IPC, unrestricted command execution, password 평문 저장은 추가하지 않았다.

### BUG-050

- ID: BUG-050
- 화면: MiSTer FPGA > MiSTer 게임 롬 관리
- 동작: PC / MiSTer 파일 전송 관리자에서 파일을 휴지통으로 이동하고 휴지통 보기를 연다.
- 문제: 화면 아래에 이전 ROM dry-run 검토/계획 패널이 남아 파일 전송 관리자 흐름을 방해했고, 휴지통이 삭제한 원본 폴더 하위에 각각 생성되어 전체 휴지통을 한 번에 보기 어려웠다.
- 기대 동작: 파일 전송 관리자 화면은 실제 파일 탐색/전송 UI만 보여주고, 모든 MiSTer 휴지통 항목은 `/media/fat/.hello-mister-trash` 하나의 통합 위치에서 볼 수 있어야 한다.
- 우선순위: High
- 상태: 완료
- 관련 커밋: `fix: simplify file transfer manager trash workflow`
- 처리 내용:
  - 파일 전송 관리자 아래의 기존 ROM dry-run 계획/검토 UI를 숨겼다.
  - 휴지통 이동 대상 경로를 `/media/fat/.hello-mister-trash/<timestamp>/<original-relative-path>`로 통합했다.
  - 휴지통 안의 항목을 다시 휴지통으로 이동하는 동작을 차단했다.
  - 휴지통 보기 버튼이 항상 `/media/fat/.hello-mister-trash`를 열도록 변경했다.
  - raw command IPC, unrestricted remote write IPC, password 평문 저장은 추가하지 않았다.
