# V1 Sticker Parity

Last verified HEAD when this document was introduced: `7a29deb`.

Status values:

- 완료: v2 has the v1 workflow mounted or integrated.
- 문제: user-visible regression exists.
- 미확인: needs manual QA against v1 behavior.
- 보류: intentionally postponed.

## Required V1 Features

| Feature | Required behavior | Current v2 status | Notes |
| --- | --- | --- | --- |
| 미스터 게임 리스트 | v1 game list/library workflow, sync/import, card/NFC linkage | 문제 | Duplicate internal connection was removed in `7a29deb`; continue validating import/launch/NFC. |
| 프로젝트 게임 | legacy project-game route compatibility | 보류 | Removed from the Sticker Production sidebar by user request. `/stickers/project-games` remains as a compatibility redirect to the MiSTer game list. |
| 템플릿 | v1 template list/selection/import/export behavior | 미확인 | Keep v1 style and data model. |
| 카드편집 | v1 card editor and working card flow | 미확인 | Card creation from game list must preserve launch path metadata. Template changes must preserve existing image transforms. |
| 이미지/에셋 | v1 asset/image loading and management | 미확인 | Must use v2 packaged assets/appData, not runtime v1 folder. |
| 카드 앨범 | v1 album, search/filter, launch/NFC actions | 문제 | Zaparoo run flow exists; allow_run diagnostics added in `7a29deb`. |
| 출력/시트 | v1 sheet/output/print/export flow | 미확인 | Must remain v1 implementation. |
| 템플릿 편집 | v1 layout/template editor | 미확인 | Must stay inside v2 AppLayout. |
| NFC 관리 | v1 NFC prepare/write workflow adapted to Zaparoo readers.write | 문제 | Needs real reader QA. Writes only after user confirmation. |

## Non-Negotiable Parity Rules

- v2 sidebar remains visible while sticker features run.
- v1 feature pages must not be replaced by a card-hub placeholder.
- v1 storage must migrate or adapt into v2 appData.
- Packaged v2 must run without the v1 source folder.

## Current Priority

1. Confirm all sticker submenu routes render inside v2 layout.
2. Confirm game list import persists.
3. Confirm card creation stores launch metadata.
4. Confirm card album launch gives actionable Zaparoo diagnostics.
5. Confirm NFC route receives the selected game path.
