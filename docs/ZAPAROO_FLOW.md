# Zaparoo Flow

Last verified HEAD when this document was introduced: `7a29deb`.

## API Basics

- Default port: `7497`
- JSON-RPC endpoint: `/api/v0.1`
- Web UI: `http://<MiSTer IP>:7497/app/`
- MiSTer config: `/media/fat/zaparoo/config.toml`
- MiSTer mappings: `/media/fat/zaparoo/mappings`

Fixed methods used by v2:

- `version`
- `health`
- `media.search`
- `media.browse`
- `media.lookup`
- `run`
- `readers`
- `readers.write`

No arbitrary JSON-RPC IPC should be exposed.

## Launch Flow

Card album and game list launch use this order:

1. Build or read ZapScript from the card/game entry.
2. Call JSON-RPC `run`.
3. If enabled for that request, try `/run/<encoded ZapScript>` fallback.
4. If both fail, classify the failure and show user guidance.
5. Never fall back to raw SSH command execution.

## Run Permissions

Remote run may be blocked by Zaparoo config.

- Setting name: `[service] allow_run`
- Type: string array of regex patterns
- Default: empty list, so remote run can be blocked.
- By default the app only diagnoses this file. A user-confirmed safe apply wizard may update only `[service]` API/run settings after preview and backup.
- The app may read it via SFTP read-only diagnostics.

Related config:

- `[service] allowed_ips`
- It can affect remote API access, depending on Zaparoo version/config.

## Read-Only Config Diagnostics

The app may read:

- `/media/fat/zaparoo/config.toml`

The app may parse:

- `[service]`
- `allow_run = [...]`
- `allowed_ips = [...]`

The app must not:

- write config.toml silently or without preview/backup
- write any remote file outside `/media/fat/zaparoo/config.toml` and `/media/fat/zaparoo/backups/config.toml.*.bak`
- reload Zaparoo silently
- run shell commands to inspect config

## Media Database Flow

- `media.search`: search by title.
- `media.lookup`: match system/name.
- `media.browse`: browse indexed media.
- Search candidates can be linked to game list entries.
- Linked media can provide `zapScript`, path, system, and metadata for card/NFC workflows.

## NFC Flow

1. Game list or card album sends selected game to `/stickers/nfc`.
2. NFC management displays game title, platform, active MiSTer, and ZapScript/path.
3. User confirms write.
4. App calls `readers` to check readers.
5. App calls `readers.write` only after user confirmation.
6. No automatic NFC write.

NFC write readiness is based on active MiSTer profile, Zaparoo API connectivity, at least one reader, and a valid payload. It must not require an SSH session id by itself because NFC writing uses Zaparoo Core API `readers.write`, not SSH command execution.

NFC read/verify does not use a `readers.read` method. The app subscribes to `GET /api/v0.1/events` and waits for the next `tokens.added` event. The user must remove the tag from the reader and place it back after pressing read so that Zaparoo emits a fresh token event. The app extracts the token text/payload, compares it with the current NFC payload, and reports verified, mismatch, timeout, cancelled, or safe error states. If SSE is unavailable, only fixed `tokens` / `tokens.history` JSON-RPC fallbacks may be tried; no arbitrary JSON-RPC or raw command IPC is exposed.

## Failure Categories

- API_OFFLINE
- API_ENDPOINT_FAILED
- RUN_METHOD_FAILED
- RUN_ENDPOINT_FAILED
- ALLOW_RUN_MISSING
- ALLOW_RUN_BLOCKED
- ALLOWED_IPS_BLOCKED
- LAUNCH_PATH_MISSING
- MEDIA_NOT_MATCHED
- UNKNOWN_ZAPAROO_ERROR

## Safe Config Apply Wizard

When diagnostics show missing or empty `[service] allow_run`, the app can prepare a recommended config patch.

- User must click `추천 설정 만들기` to generate a patch preview.
- User must review the diff and click `백업 후 적용` before any remote write.
- The app writes by SFTP only.
- Allowed remote write targets are strictly limited to:
  - `/media/fat/zaparoo/config.toml`
  - `/media/fat/zaparoo/backups/config.toml.YYYYMMDD-HHmmss.bak`
- The app creates a local backup under appData `backups/zaparoo/`.
- Remote backup failure blocks apply unless the user explicitly allows local-backup-only continuation.
- The patch touches only `[service] api_port`, `api_listen`, `allowed_ips`, and `allow_run`.
- Recommended `allow_run` is `**launch:/media/fat/(games|_Arcade)/.*`.
- After apply, the app tries JSON-RPC `settings.reload`; if unsupported or failed, it tells the user to restart Zaparoo Core or reboot MiSTer.
- No raw command IPC, arbitrary SSH command, ROM copy/upload, mkdir, rename, delete, or config auto-edit is introduced.
- Developer mode only: the Zaparoo config apply wizard is hidden in basic and advanced modes.
