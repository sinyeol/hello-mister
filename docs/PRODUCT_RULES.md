# Product Rules

Last verified HEAD when this document was introduced: `7a29deb`.

## Product Position

Hello Mister v2.0 is not a newly rebuilt sticker app. It is an update that keeps the v1.0 sticker app as the product base and adds MiSTer management workflows around it.

The v1 sticker workflow is the center of the app:

- project games
- MiSTer game list
- templates
- working cards
- images/assets
- card album
- sheet/output
- template editor
- NFC management

MiSTer management is an added capability. It must support the sticker workflow instead of replacing it.

## V1 Sticker App Rules

- Do not replace v1 functionality with a new MVP or placeholder.
- Do not simplify away v1 menus, data structures, or UI flows unless the user explicitly requests it.
- Do not use `<v1 참조 폴더(zaparoo-nfc-card-stickers)>` as a runtime dependency.
- The v1 folder may be read for analysis only.
- Any needed v1 code/assets must live inside the v2 project before packaging.

## MiSTer Safety Rules

Dangerous MiSTer operations stay locked unless the user asks for that exact feature and the implementation includes explicit safety controls.

Locked by default:

- raw command IPC
- arbitrary SSH command execution
- remote file overwrite/delete/rename/chmod/chown
- remote reboot/shutdown
- MiSTer.ini remote apply
- SD format/flash
- ROM copy/upload until explicitly opened with preflight, progress, cancel, and verification

## Credential Rules

- Do not store password, private key, passphrase, token, raw credential, or raw command in appData JSON.
- MiSTer passwords may use Electron `safeStorage`.
- If `safeStorage` is unavailable, keep the password session-only and tell the user.
- Exports, task logs, diagnostics, and reports must be sanitized.

## Work Rules

- Prefer one issue or one user flow per change.
- Read these docs before changing behavior.
- Keep v1 parity first, MiSTer management second.
- Run tests before commit.
- Do not run `npm audit fix`.
- Do not perform an Electron major update without an explicit task.
