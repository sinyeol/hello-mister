# Menu Structure

Last updated for: `fix: reorganize sidebar into mister sticker settings groups`

## App Modes

Hello Mister v2.0 uses two user-facing app modes only:

- 기본
- 고급

Legacy stored values are migrated as follows:

- `simple` -> `basic`
- `basic` -> `basic`
- `advanced` -> `advanced`
- `developer` -> `advanced`
- unknown -> `basic`

There is no user-facing developer mode and no direct developer tools menu. Internal diagnostics that were previously developer-only are available as collapsed sections inside advanced Settings, Backup/Diagnostics, or the relevant management screen.

## Top-Level Sidebar Groups

The sidebar has exactly three top-level parent groups, in this order:

1. MiSTer FPGA
2. 스티커 제작
3. 설정

Each top-level group is an expand/collapse control only. Clicking a parent group must not navigate. Only child menu items navigate. Parent groups default to collapsed, but the group for the current child route may auto-expand so the active item is visible.

## Basic Mode

Basic mode keeps the v1 sticker workflow central and exposes only everyday MiSTer support.

- MiSTer FPGA
  - MiSTer 연결 -> `/mister`
  - MiSTer 게임 롬 관리 -> `/games`
  - INI 설정 -> `/ini`
- 스티커 제작
  - 미스터 게임 리스트 -> `/stickers/mister`
  - 템플릿 -> `/stickers/templates`
  - 카드편집 -> `/stickers/editor`
  - 이미지/에셋 -> `/stickers/images`
  - 카드 앨범 -> `/stickers/album`
  - 출력/시트 -> `/stickers/output`
  - 템플릿 편집 -> `/stickers/template-editor`
  - NFC 관리 -> `/stickers/nfc`
- 설정
  - 앱 설정 -> `/settings`

The 스티커 제작 parent item does not navigate to `/stickers` and must not mount the v1 shell by itself. Sticker submenu items navigate to the v1 feature routes in the v2 content area.

## Advanced Mode

Advanced mode includes every basic item plus the larger MiSTer management screens.

- MiSTer FPGA
  - MiSTer 연결
  - MiSTer 게임 롬 관리
  - SD 카드 관리
  - INI 설정
  - 스크립트 관리
  - 컨트롤러 관리
- 스티커 제작
  - all sticker submenu items from Basic Mode
- 설정
  - 앱 설정
  - 백업/복구

Advanced mode may expose internal diagnostics in collapsed sections inside app settings, backup/restore, or the relevant management screen:

- appData status
- IPC capability checks
- task logs
- reports
- safety policies
- feature flags and locks
- known hosts
- autodiscovery archive
- export and validation details

## Removed Menus

- 홈
- 스티커 홈
- 동기화
- 개발자 도구
- 프로젝트 게임

## Naming Rules

- 미스터 라이브러리 -> 미스터 게임 리스트
- 라이브러리 동기화 -> 게임 리스트 동기화
- 게임 미리 검사 -> MiSTer 게임 롬 관리
- 작업 카드 -> 카드편집
- dry-run -> 복사 전 확인
- simulated transfer -> 복사 시뮬레이션
- preflight guard -> 실행 전 안전 검사
- kill switch -> 전송 전체 잠금
- feature flag -> 기능 잠금 설정
- host key / fingerprint -> SSH 장치 신뢰 키 / 신뢰 키 지문

## Menu Boundary

- 미스터 게임 리스트: game list, metadata, card creation, launch, NFC.
- MiSTer 게임 롬 관리: ROM file copy/delete/move/folder management inside allowed ROM roots.
- MiSTer 연결: IP/profile/password/connection status only.
- NFC 관리: card write/read/verify workflow through Zaparoo readers.
