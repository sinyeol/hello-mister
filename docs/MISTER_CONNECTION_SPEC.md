# MiSTer Connection Spec

Last verified HEAD when this document was introduced: `7a29deb`.

## Connection Model

The default MiSTer connection flow is manual and IP-based.

- IP direct input
- alias input
- username default: `root`
- password field default: `1`
- port default: `22`
- Save
- Connect
- Edit
- Delete

## Auto Connection Policy

- Do not connect when the app starts.
- Do not connect immediately after saving a profile.
- Only connect when the user clicks `연결`.
- After a user-initiated successful connection, the active session/profile may be reused across menus.
- If the session drops, read-only APIs may reconnect using the active profile and secure password storage.

## Password Policy

- Default password `1` is a UI default, not a plaintext appData value.
- Password storage uses Electron `safeStorage`.
- If `safeStorage` is unavailable, do not persist the password.
- Never write passwords/private keys/passphrases/tokens into profile JSON, task logs, exports, or diagnostics.

## Active Profile

`activeMisterProfile` is the shared source for:

- 미스터 게임 리스트
- MiSTer 게임 롬 관리
- INI 설정
- 스크립트 관리
- 컨트롤러 관리
- NFC 관리

On successful connection:

- update renderer active profile
- update Electron main active profile
- update last connected status
- preserve session until explicit disconnect/delete or process shutdown

On delete:

- remove profile
- remove profile summary
- remove session memory
- remove safeStorage secret for that profile
- clear active profile if it was active
- optionally remove SSH known host only when the user selects that option

## Auto Discovery

Network auto discovery is not the main flow.

- It may exist as a helper button near the connection form.
- It must not replace IP direct input.
- Advanced mode may keep detailed discovery/debug views in collapsed internal diagnostics.

## Host Key

- Basic mode: simple trust prompt on first use; mismatch blocks connection.
- Advanced mode: fingerprint, known hosts, and history details.
