# Manual QA Checklist

Last verified HEAD when this document was introduced: `7a29deb`.

Use this checklist for real app review after each focused change.

## Startup

- [ ] Launch Electron review build.
- [ ] Confirm v2 left sidebar is visible.
- [ ] Confirm app starts at `/stickers/mister` or last intended sticker route.
- [ ] Confirm no white screen.

## MiSTer Connection

- [ ] Open `MiSTer 연결`.
- [ ] Enter IP.
- [ ] Enter alias.
- [ ] Confirm username default is `root`.
- [ ] Confirm password field default is `1`.
- [ ] Save profile.
- [ ] Confirm no automatic connection after save.
- [ ] Click `연결`.
- [ ] Confirm connected status.
- [ ] Navigate to another menu and confirm connection state remains.
- [ ] Edit saved profile.
- [ ] Delete saved profile.
- [ ] Restart app and confirm deleted profile does not return.

## Sticker Menu Walkthrough

- [ ] 미스터 게임 리스트
- [ ] 템플릿
- [ ] 카드편집
- [ ] 이미지/에셋
- [ ] 카드 앨범
- [ ] 출력/시트
- [ ] 템플릿 편집
- [ ] NFC 관리

## Game List

- [ ] Open 미스터 게임 리스트.
- [ ] Confirm no duplicate internal connection tab.
- [ ] Confirm active MiSTer is shown or `MiSTer 연결로 이동` appears.
- [ ] Run 게임 리스트 동기화.
- [ ] Confirm import list starts with all items excluded.
- [ ] Select a few entries and import.
- [ ] Restart app and confirm imported entries remain.
- [ ] Confirm new platform list excludes existing platforms.

## Card Workflow

- [ ] Create card from a game list entry.
- [ ] Confirm launch path metadata is saved.
- [ ] Open card album.
- [ ] Click launch.
- [ ] If launch fails, confirm error names `allow_run` and shows actionable Zaparoo guidance.
- [ ] Click NFC.
- [ ] Confirm NFC management receives title/platform/path.

## ROM Management

- [ ] Open `MiSTer 게임 롬 관리`.
- [ ] Confirm labels use `복사 전 확인`, not dry-run.
- [ ] Confirm actual copy/delete buttons stay locked until explicitly implemented.

## Settings / Developer

- [ ] Confirm basic mode hides developer diagnostics.
- [ ] Confirm developer mode shows logs/reports/appData/IPC checks.
- [ ] Confirm no plaintext password in exported diagnostics.

## Safety

- [ ] No raw command IPC.
- [ ] No ROM upload/copy IPC unless explicitly opened in a later task.
- [ ] No remote mkdir/rename/delete/overwrite IPC.
- [ ] No SD format/flash execution unless the user explicitly opens that feature with safety controls.
