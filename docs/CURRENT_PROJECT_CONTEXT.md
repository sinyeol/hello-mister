# Current Project Context

Last updated from HEAD: `676eb1e`

This document is the first file to read before new work on Hello Mister v2.0. It consolidates the current product direction, menu boundaries, safety rules, and recently verified app behavior so future tasks can stay small and consistent.

## Project Paths

- v2 project root: `<프로젝트 루트>`
- v1 sticker app reference folder: `<v1 참조 폴더(zaparoo-nfc-card-stickers)>`

Rules:

- The v1 folder is read-only reference material.
- Do not modify the v1 folder.
- Do not use the v1 folder as a runtime dependency.
- Packaged v2 must keep working when the v1 source folder is absent.
- Any v1 code, assets, or behavior needed at runtime must live inside the v2 project.

## Product Direction

Hello Mister v2.0 is not a newly rebuilt sticker app. It is the v1.0 sticker app as the product base, with MiSTer management workflows added around it.

The v1 sticker workflow remains the center of the app. MiSTer features should support sticker creation, game lists, launch, NFC, ROM file management, INI management, and diagnostics without replacing the v1 sticker experience with a simplified MVP or placeholder.

## App Modes

The user-facing app modes are:

- `basic`: default mode for the sticker workflow and simple MiSTer support.
- `advanced`: exposes MiSTer management screens and internal diagnostics as collapsed or scoped sections.

There is no separate user-facing developer mode. Legacy `developer` values should be treated as `advanced`.

## Sidebar And Menu Rules

The v2 left sidebar must remain visible while sticker features run.

The sidebar has exactly three top-level parent groups in this order:

1. MiSTer FPGA
2. Sticker Production
3. Settings

The parent groups are expand/collapse controls only. Parent clicks do not navigate. Child menu clicks navigate. Parent groups default to collapsed, but the parent for the current child route may auto-expand so the active submenu remains visible.

MiSTer FPGA submenus:

- MiSTer connection -> `/mister`
- MiSTer game ROM management -> `/games`
- SD card management -> `/sd-card`, advanced only
- INI settings -> `/ini`
- Script management -> `/scripts`, advanced only
- Controller management -> `/controllers`, advanced only

Sticker Production submenus:

- MiSTer game list -> `/stickers/mister`
- Templates -> `/stickers/templates`
- Card edit -> `/stickers/editor`
- Images/assets -> `/stickers/images`
- Card album -> `/stickers/album`
- Sheet/output -> `/stickers/output`
- Template editor -> `/stickers/template-editor`
- NFC management -> `/stickers/nfc`

Settings submenus:

- App settings -> `/settings`
- Backup/restore -> `/backup`, advanced only

Sticker Production should not take over the whole app shell. v1 sticker features render inside the v2 content area.

Game list and ROM management are different workflows:

- Game list: MiSTer game list, metadata, card creation, launch, NFC.
- ROM management: file copy, move, rename, trash, folder creation, and MiSTer-to-PC or PC-to-MiSTer transfer.

## MiSTer Connection Baseline

Connection is manual and IP-based.

- IP direct input.
- Username default: `root`.
- Password field default: `1`.
- `autoConnect` default: `false`.
- Saving a profile must not connect automatically.
- App startup must not connect automatically.
- A connection is attempted only when the user clicks `Connect`.
- Auto discovery is a helper, not the main flow.
- Passwords use Electron `safeStorage`.
- appData profile JSON must not contain plaintext passwords, private keys, passphrases, or tokens.

After a user-initiated connection succeeds:

- Renderer active profile and Electron main active profile stay synchronized.
- Sticker v1 bridge calls should use the same active MiSTer profile.
- Read-only follow-up actions may reuse or recreate the active session with safeStorage credentials.

## Verified Game List Baseline

The MiSTer game list sync workflow has these verified expectations:

- Scan uses the active MiSTer profile.
- The default import state is unchecked/excluded.
- Only user-selected platforms or entries are imported.
- New platform discovery excludes platforms already in the saved game list.
- Platform comparison uses normalized keys, so aliases like `NEOGEO`, `Neo Geo`, and `neo-geo` are treated as the same platform.
- Card creation from game list entries preserves launch path metadata for album launch and NFC workflows.

## Card Editor Baseline

- The Sticker Production sidebar exposes `/stickers/editor` as `카드편집`.
- `프로젝트 게임` is no longer a sidebar item; legacy `/stickers/project-games` still redirects to the MiSTer game list for compatibility.
- Changing a card template must preserve existing main/logo image asset references and their saved image transforms.
- Preserved image transform fields include position, scale, size, crop, rotation, fit mode, and equivalent slot override data.
- If the next template uses different image layer ids, the existing main/logo transform is mapped onto the next template's matching image slot.
- Batch image matching applies the v1 centered image zoom default to newly matched main images only. Existing manually adjusted cards are not reset by template changes.
- Batch image matching must force the same 25-step centered zoom used by the manual center zoom button for newly matched main images, then persist that slot override so the album/editor reopen path keeps the zoomed state.

## Controller Management Baseline

- Controller management reads bounded controller-related paths from the active MiSTer profile and does not use raw commands.
- `.map` and other binary-like controller files are previewed as bytes/hex instead of decoded text.
- Controller backups are created through the controller-only adapter and restore first backs up the current target file.
- Controller map analysis parses filename-derived information only. For example, `1941r_input_16D0_1358_v3.map` is treated as game key `1941r`, inferred controller key `16D0_1358_v3`, VID `16D0`, PID `1358`, and version `v3`.
- The app may group `.map` files by inferred controller key, inferred game key, and byte length.
- Byte diff views show offsets, hex bytes, decimal bytes, length warnings, identical/different status, and frequent changing offsets.
- Local controller map presets store selected `.map` bytes, SHA-256, source file path, inferred game/controller keys, and notes in local metadata only.
- Controller map preset candidates are grouped by `controllerKey + byteLength + sha256`. The candidate UI defaults to the dominant controller key and 128-byte groups, while 2048-byte maps are treated as exceptions.
- Saving a candidate preset reads only the selected representative `.map` file and stores that byte payload locally with SHA, covered file count, sample game keys, and a conservative family label.
- Preset apply is currently dry-run only. It can compare a source preset with a target `.map` file and report required backup, byte length match, controller key match, target-path eligibility, warnings, and diff. Default eligibility requires the same controller key, the same byte length, and a target under `/media/fat/config/inputs/*.map`. It must not write the remote target file until a later explicit apply phase is opened with backup/restore verification.
- Button meanings such as A/B/X/Y are not inferred from byte offsets unless an official structure is verified.
- Controller map analysis can be exported as lightweight ZIP, metadata-only JSON, CSV, or advanced full-bytes ZIP for external review. The recommended ZIP includes `controller-map-analysis.json`, file/group CSVs, and `README.txt` for ChatGPT upload.
- Default controller map exports are lightweight structured data only: file names, remote paths, inferred game/controller keys, VID/PID/version, byte length, SHA-256 when available, conservative platform guesses, and groups by controller, game, SHA-256, byte length, and platform.
- `bytesBase64`, `hex`, and `decimalBytes` are included only in explicit full-bytes exports. Full all-files export requires a warning confirmation; selected group full export is preferred when raw bytes are truly needed.
- Controller map exports must not include passwords, private keys, passphrases, tokens, local Windows user paths, raw command data, or inferred button meanings.

## Zaparoo Integration Baseline

Zaparoo Core API:

- Default port: `7497`
- JSON-RPC endpoint: `/api/v0.1`
- Web UI: `http://<MiSTer IP>:7497/app/`

Fixed methods used by the app:

- `version`
- `health`
- `media.search`
- `media.browse`
- `media.lookup`
- `run`
- `readers`
- `readers.write`

Launch flow:

- Card album and game list launch use Zaparoo `run`.
- `/run/<encoded ZapScript>` may be used as a fallback.
- Never fall back to raw SSH command execution.
- Do not expose arbitrary JSON-RPC IPC.

Config guidance:

- Correct setting name: `[service] allow_run`
- Also relevant: `[service] allowed_ips`
- Do not use obsolete launch-setting names; `[service] allow_run` is the correct setting.
- Zaparoo config path: `/media/fat/zaparoo/config.toml`
- Mappings path: `/media/fat/zaparoo/mappings`
- The app may diagnose config read-only.
- The safe apply wizard may only touch Zaparoo `[service]` API/run settings after preview and backup.

Example context from real QA:

- PC IP: `192.168.0.10 (예시)`
- MiSTer IP: `192.168.0.11 (예시)`
- Example allow_run pattern: `**launch:/media/fat/(games|_Arcade)/.*`
- The pattern is a regex against the full ZapScript. Escape literal `*` if the actual config syntax requires it.

## NFC Baseline

NFC write:

- Uses Zaparoo `readers.write`.
- Requires user click and confirmation.
- Does not require an SSH session by itself when active profile, Zaparoo API, reader, and payload are valid.

NFC read/verify:

- Does not use nonexistent `readers.read`.
- Uses `/api/v0.1/events` and waits for a fresh `tokens.added` event.
- The user should remove the tag and place it back on the reader after starting read/verify.
- The app compares the token text/payload against the current NFC payload and reports verified, mismatch, timeout, cancelled, or safe error states.

## ROM Manager Baseline

The MiSTer game ROM manager is an explorer-style two-pane workflow:

- Left/right PC and MiSTer file panes.
- Columns: name, extension, size.
- Modified date is not shown by default.
- Compact density.
- Ctrl/Shift multi-select.
- Drag selection.
- PC to MiSTer drag copy.
- MiSTer to PC drag copy.
- Context menus for copy, move, rename, trash, and information.
- Work queue/logs are hidden behind a work panel instead of occupying the main explorer area.

Allowed remote write roots for ROM management:

- `/media/fat/games`
- `/media/fat/_Arcade`

ROM manager writes must remain restricted to those roots. Raw command IPC and unrestricted remote write IPC remain banned.

## INI Settings Baseline

INI settings are based on the connected MiSTer, not mock presets.

Remote INI targets:

- `/media/fat/MiSTer.ini`
- `/media/fat/MiSTer_alt_*.ini`
- `/media/fat/MiSTer_*.ini`

Display and source rules:

- Remote files should be read from the active MiSTer `/media/fat` root.
- Remote files win over metadata/cache.
- Source badges distinguish remote, local, pending upload, cache, and remote missing.
- The current MiSTer alias/IP must be visible.

Editing rules:

- The main editor is GUI-based, not a raw text editor.
- Values are not autosaved.
- Save button is required.
- Save requires backup first.
- `MiSTer.ini` deletion is blocked.
- Alt/custom INI files move to INI trash instead of immediate deletion.
- Backup and trash lists live under the INI list as collapsible sections.
- Backup retention is 10 per INI file.

Help rules:

- Do not invent meaning for undocumented INI options.
- Detailed help is allowed only when based on the official help catalog, official MiSTer docs, official MiSTer.ini comments, or official `ini_settings.sh`.
- Unknown keys should say that the app has not confirmed their official meaning.
- Original comments may be shown, but do not expand beyond what the comment says.
- ON/OFF toggles should be used only for catalog-confirmed boolean entries; unknown `0`/`1` values remain regular raw value inputs.

## Controller Management Baseline

Controller management is an advanced MiSTer management screen at `/controllers`.

Current implemented scope:

- Uses the shared active MiSTer profile.
- Scans controller-related files with read-only SFTP from bounded candidate folders.
- Candidate folders include `/media/fat`, `/media/fat/config`, known input/controller subfolders under config, and `/media/fat/Scripts`.
- Candidate file names are limited to `gamecontrollerdb*`, `*controller*`, `*joystick*`, `*input*`, `*.map`, `*.cfg`, `*.ini`, and `*.txt`.
- Failed folders are recorded without failing the whole screen.
- Refresh scans must always finalize into `ready`, `empty`, `partial`, `error`, or `timeout`; the UI must not stay stuck on a loading message when no candidate files exist.
- Scan diagnostics include the active profile, candidate roots, scanned roots, failed roots, errors, started/finished times, duration, and final status.
- Empty results are valid when no controller-related files match the bounded patterns.
- File contents are shown read-only.
- Text-like controller files use text preview; `.map` and binary-like mapping files use byte/hex preview and are not semantically interpreted until the mapping structure is verified.
- Backups use a controller-only binary-safe adapter and are stored under `/media/fat/.hello-mister-backups/controllers/**`; local appData backups are attempted as a companion backup.
- Backup preview is read-only and uses the same text/hex preview model as the source file preview.
- Restore is allowed only for controller-related files under `/media/fat/config/**` and requires confirmation; the current file must be automatically backed up before restore proceeds.
- Restore writes and verifies bytes, not UTF-8 strings, so `.map` backups can round-trip safely.
- Remote backups keep 10 entries per source file.
- Preset structures exist for NeoGeo 4-button, CPS 6-button, and Console Pad, but apply buttons stay disabled until target mapping file structures are verified.
- SHA-based preset candidates group maps by `controllerKey + byteLength + sha256`; default candidates prioritize the dominant controller key and 128-byte maps, while 2048-byte maps are shown as exceptions.
- Candidate presets store only the selected representative `.map` bytes locally. Actual remote `.map` apply remains disabled and dry-run eligibility is limited to same controller key, same byte length, and `/media/fat/config/inputs/*.map` targets.
- The controller IPC channels are defined in `electron/controller-ipc-channels.mjs` and used by both Electron main and preload.
- `controllerFs:scanInventory` is registered through the dedicated controller IPC registration path before the BrowserWindow is created, so refresh cannot fail with a missing handler in packaged review builds.
- Renderer-side IPC failure results preserve the bounded controller candidate roots and classify a missing `controllerFs:scanInventory` handler as a restart/build mismatch instead of a remote scan failure.
- The Electron smoke test invokes `controllerFsScanInventory` directly and fails if the handler is missing.

Still not implemented:

- Raw command based realtime controller detection.
- `lsusb`, `dmesg`, `/proc/bus/input/devices`, or arbitrary SSH command inspection.
- Mapping-file semantic editing or automatic preset application.

## Always Banned Unless A Later Task Explicitly Opens A Narrow Safe Path

- Modifying the v1 folder.
- Using the v1 folder as a runtime dependency.
- Raw command IPC.
- Arbitrary SSH command execution.
- Plaintext password/privateKey/passphrase/token storage.
- Unrestricted remote write IPC.
- Remote write outside explicitly allowed scoped adapters.
- Electron major update.
- `npm audit fix`.

## npm Audit Status

The known npm audit state remains:

- `electron <=39.8.4` high severity issue.
- Do not run `npm audit fix`.
- Do not update Electron to a new major version unless a user task explicitly requests it.

## Work Method

Before code changes:

1. Read `docs/CURRENT_PROJECT_CONTEXT.md`.
2. Read the relevant spec docs for the area being changed.
3. Check `git status`.
4. Prefer one `BUG_QUEUE` issue or one user flow per task.
5. Keep changes scoped.
6. Update or add focused tests.
7. Run verification.
8. Commit after verification passes.

Standard verification:

```powershell
npx tsc --noEmit
npm.cmd run lint
npm.cmd run build
npm.cmd run test
```

For Electron UI or packaging-sensitive work, also run:

```powershell
npm.cmd run package:review
npm.cmd run smoke:electron
```
