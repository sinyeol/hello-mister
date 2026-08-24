import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const page = read('src/pages/ControllerManagementPage.tsx');
const service = read('src/services/controllers/controllerFileService.ts');
const desktopService = read('src/services/controllers/controllerDesktopService.ts');
const mapAnalysisService = read('src/services/controllers/controllerMapAnalysisService.ts');
const mapExportService = read('src/services/controllers/controllerMapExportService.ts');
const controllerTypes = read('src/types/controllers.ts');
const desktopTypes = read('src/types/desktop.ts');
const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');
const controllerChannels = read('electron/controller-ipc-channels.mjs');
const packageJson = JSON.parse(read('package.json'));

assert.match(page, /controllerDesktopService\.scanInventory/, 'controller page should scan real active MiSTer controller inventory');
assert.match(page, /getActiveMisterProfile/, 'controller page should hydrate the shared active MiSTer profile');
assert.match(page, /MiSTer 연결로 이동/, 'controller page should guide users to MiSTer connection when no active profile exists');
assert.match(page, /내용 보기/, 'controller page should expose read-only content preview');
assert.match(page, /백업/, 'controller page should expose backup workflow');
assert.match(page, /복원 전 현재 파일을 다시 백업/, 'controller restore should warn that the current file is backed up first');
assert.match(page, /실시간 물리 컨트롤러 감지는 raw command 없이/, 'controller page should explain realtime device detection limits without raw commands');
assert.match(page, /적용 준비 중/, 'controller presets should remain disabled until file structures are verified');

for (const candidatePath of [
  '/media/fat',
  '/media/fat/config',
  '/media/fat/config/inputs',
  '/media/fat/config/input',
  '/media/fat/config/joystick',
  '/media/fat/config/joysticks',
  '/media/fat/config/controllers',
  '/media/fat/config/gamecontrollerdb',
  '/media/fat/Scripts',
]) {
  assert.match(service + main, new RegExp(candidatePath.replace(/[/.]/g, '\\$&')), `${candidatePath} should be part of the controller read-only scan candidates`);
}

for (const pattern of ['gamecontrollerdb', 'controller', 'joystick', 'input', 'map|cfg|ini|txt']) {
  assert.match(service + main, new RegExp(pattern), `${pattern} should be part of the controller candidate file detection`);
}

assert.match(controllerTypes, /ControllerInventoryStatus = 'ready' \| 'empty' \| 'partial' \| 'error' \| 'timeout'/, 'controller inventory should expose explicit final scan statuses');
assert.match(controllerTypes, /ControllerInventoryDiagnostics/, 'controller inventory should include scan diagnostics');
assert.match(desktopService, /status: 'error'/, 'browser fallback inventory should finalize as an error result');
assert.match(desktopService, /diagnostics/, 'browser fallback inventory should include diagnostics');

assert.match(main, /controllerScanTimeoutMs = 30_000/, 'main controller scan should have a timeout guard');
assert.match(main, /controllerFolderReadTimeoutMs = 5_000/, 'each controller candidate folder read should have a timeout guard');
assert.match(main, /summarizeControllerInventoryStatus/, 'main scan should classify ready empty partial and error results');
assert.match(main, /status === 'empty'/, 'main scan should support empty results without remaining stuck');
assert.match(main, /status === 'partial'/, 'main scan should support partial results when some roots fail');
assert.match(main, /candidateRoots: controllerCandidateDirs/, 'main scan diagnostics should include candidate roots');
assert.match(main, /scannedRoots/, 'main scan diagnostics should include scanned roots');
assert.match(main, /failedRoots/, 'main scan diagnostics should include failed roots');
assert.match(main, /durationMs/, 'main scan diagnostics should include duration');

assert.match(page, /createTimeoutInventory/, 'renderer should finalize stuck scans with timeout inventory');
assert.match(page, /controllerCandidatePaths/, 'renderer timeout and IPC error inventories should keep the bounded controller candidate roots');
assert.match(page, /CONTROLLER_FS_IPC_HANDLER_MISSING/, 'renderer should classify missing controller IPC handler errors clearly');
assert.match(page, /Promise\.race/, 'refresh click should not wait forever for a stuck scan promise');
assert.match(page, /scanRunRef/, 'renderer should ignore stale scan completions after retry or unmount');
assert.match(page, /mountedRef/, 'renderer should avoid state updates after unmount');
assert.match(page, /컨트롤러 관련 후보 파일을 찾지 못했습니다/, 'empty scan should show a complete empty state message');
assert.match(page, /일부 경로를 읽지 못했습니다/, 'partial scan should show failed root guidance');
assert.match(page, /컨트롤러 설정 파일 읽기가 시간 초과되었습니다/, 'timeout scan should show a retryable timeout message');
assert.match(page, /candidateRoots/, 'developer detail should not render an empty diagnostics object');
assert.match(page, /failedRoots/, 'developer detail should show failed roots');
assert.match(page, /errors/, 'developer detail should show scan errors');
assert.match(page, /durationMs/, 'developer detail should show scan duration');

assert.match(service, /controllerPresetList/, 'controller preset structure should be modeled in the renderer');
assert.match(service, /NeoGeo 4/, 'NeoGeo preset should exist');
assert.match(service, /CPS 6/, 'CPS preset should exist');
assert.match(service, /Console Pad/, 'Console Pad preset should exist');

for (const api of [
  'controllerFsScanInventory',
  'controllerFsReadFile',
  'controllerFsReadControllerFile',
  'controllerFsCreateBackup',
  'controllerFsListBackups',
  'controllerFsReadBackup',
  'controllerFsRestoreBackup',
]) {
  assert.match(desktopTypes, new RegExp(api), `${api} should be typed on the desktop API`);
  assert.match(preload, new RegExp(api), `${api} should be exposed through preload`);
  assert.match(desktopService, new RegExp(api), `${api} should be used by the renderer service`);
}

const controllerChannelNames = [
  ['scanInventory', 'controllerFs:scanInventory'],
  ['readFile', 'controllerFs:readFile'],
  ['readControllerFile', 'controllerFs:readControllerFile'],
  ['createBackup', 'controllerFs:createBackup'],
  ['listBackups', 'controllerFs:listBackups'],
  ['readBackup', 'controllerFs:readBackup'],
  ['restoreBackup', 'controllerFs:restoreBackup'],
];

assert.match(controllerChannels, /CONTROLLER_FS_CHANNELS/, 'controller IPC channels should be defined in one shared Electron module');
assert.match(main, /CONTROLLER_FS_CHANNELS/, 'Electron main should use the shared controller IPC channel constants');
assert.match(preload, /CONTROLLER_FS_CHANNELS/, 'preload should use the shared controller IPC channel constants');
assert.match(main, /function registerControllerIpc\(\)/, 'controller IPC handlers should have a dedicated registration function');
assert.match(main, /registeredControllerIpcChannels/, 'controller IPC registration should be guarded against duplicate registration');
assert.match(main, /registerControllerIpc\(\);\s*registerIpc\(\);\s*return createWindow\(\);/s, 'controller IPC should register before the BrowserWindow is created');
assert.match(main, /function registerIpc\(\) \{[\s\S]*registerControllerIpc\(\);[\s\S]*\n\}/, 'registerIpc should be able to call the controller registration safely');

for (const [key, channel] of controllerChannelNames) {
  assert.match(controllerChannels, new RegExp(`${key}: '${channel}'`), `${channel} should be declared in the shared controller channel module`);
  assert.match(main, new RegExp(`CONTROLLER_FS_CHANNELS\\.${key}`), `${channel} should be registered in Electron main through the shared constant`);
  assert.match(preload, new RegExp(`CONTROLLER_FS_CHANNELS\\.${key}`), `${channel} should be invoked from preload through the shared constant`);
}

assert.match(main, /controllerBackupRoot = '\/media\/fat\/\.hello-mister-backups\/controllers'/, 'controller backups should be scoped to the controller backup folder');
assert.match(main, /controllerTrashRoot = '\/media\/fat\/\.hello-mister-trash\/controllers'/, 'controller trash scope should be modeled separately');
assert.match(main, /assertControllerRestoreTargetPath[\s\S]*\/media\/fat\/config/, 'controller restore should be limited to /media/fat/config targets');
assert.match(main, /backupControllerFile[\s\S]*pruneControllerBackups\(sftp, sourcePath, 10\)/, 'controller backups should keep at most 10 remote backups');
assert.match(main, /writeLocalControllerBackup/, 'controller backup should also attempt a local appData backup');
assert.match(main, /sftpReadBuffer/, 'controller backup and restore should use binary-safe reads');
assert.match(main, /sftpWriteControllerBackupFile/, 'controller backups should write only through the controller backup adapter');
assert.match(main, /sftpWriteControllerRestoreFile\(sftp, targetPath, backupContent\)/, 'controller restore should write only through the controller restore adapter');
assert.match(main, /controllerSha256/, 'controller backup metadata should include a content hash when possible');
assert.match(main, /CONTROLLER_FS_RESTORE_TARGET_NOT_FOUND/, 'controller restore should stop if the current file cannot be auto-backed up first');
assert.match(main, /verification\.equals\(backupContent\)/, 'controller restore should verify restored bytes');
assert.match(main, /buildControllerFilePreview/, 'controller reads should build a safe preview model');
assert.match(main, /mode: 'hex'/, 'binary-like controller files should support hex previews');
assert.match(main, /decimalBytes/, 'hex previews should include decimal byte output');
assert.match(main, /bytesBase64: buffer\.toString\('base64'\)/, 'controller read results should expose read-only bytes for map analysis');
assert.match(main, /sha256: controllerSha256\(buffer\)/, 'controller read results should expose SHA-256 for comparison and presets');
assert.match(page, /ControllerPreviewBlock/, 'controller page should render previews through a single read-only preview block');
assert.match(page, /CONTROLLER_FS_RENDERER_READ_FAILED/, 'controller page should show read errors instead of silently doing nothing');
assert.match(page, /CONTROLLER_FS_RENDERER_BACKUP_READ_FAILED/, 'controller page should show backup preview errors instead of silently doing nothing');
assert.match(page, /controllerDesktopService\.readBackup/, 'controller page should expose backup preview');
assert.match(desktopService, /controllerFsReadBackup/, 'renderer service should call the readBackup IPC');
assert.match(desktopService, /No handler registered for \['"\]controllerFs:readControllerFile/, 'renderer service should fall back to the legacy readFile IPC if the new readControllerFile handler is unavailable');
assert.match(desktopService, /createLegacyDecodedControllerPreview/, 'legacy decoded controller content should be converted into a safe preview');
assert.match(desktopService, /hasSuspiciousDecodedContent/, 'renderer service should detect replacement/control-character decoded content');
assert.match(desktopService, /\.map\$/i, 'renderer service should treat .map controller files as binary-like previews');
assert.match(desktopService, /mode: 'hex'/, 'legacy binary-like controller content should render as a hex preview');
assert.match(page, /hasSuspiciousControllerText/, 'controller page should hide suspicious decoded text if preview metadata is missing');
assert.match(page, /깨진 문자열은 숨겼습니다/, 'controller page should not show garbled legacy binary text directly');

assert.match(mapAnalysisService, /parseControllerMapFileName/, 'controller map filename parser should exist');
assert.match(mapAnalysisService, /\^(.+)_input_\(\[0-9a-f\]\{4\}\)_\(\[0-9a-f\]\{4\}\)_\(v\[0-9\]\+\)\$/i, 'filename parser should recognize game_input_VID_PID_vN map names');
assert.match(mapAnalysisService, /gameKey/, 'filename parser should expose gameKey');
assert.match(mapAnalysisService, /controllerKey/, 'filename parser should expose controllerKey');
assert.match(mapAnalysisService, /vid: vid\.toUpperCase\(\)/, 'filename parser should expose VID');
assert.match(mapAnalysisService, /pid: pid\.toUpperCase\(\)/, 'filename parser should expose PID');
assert.match(mapAnalysisService, /groupControllerMapFiles/, 'controller map grouping helper should exist');
assert.match(mapAnalysisService, /byController/, 'controller maps should be groupable by controllerKey');
assert.match(mapAnalysisService, /byGame/, 'controller maps should be groupable by gameKey');
assert.match(mapAnalysisService, /byLength/, 'controller maps should be groupable by byte length');
assert.match(mapAnalysisService, /compareControllerMapBytes/, 'byte diff utility should exist');
assert.match(mapAnalysisService, /offset/, 'byte diff utility should report offsets');
assert.match(mapAnalysisService, /aHex/, 'byte diff utility should report A hex bytes');
assert.match(mapAnalysisService, /bHex/, 'byte diff utility should report B hex bytes');
assert.match(mapAnalysisService, /lengthWarning/, 'byte diff utility should warn when map lengths differ');
assert.match(mapAnalysisService, /summarizeFrequentDiffOffsets/, 'multi-file comparison should summarize frequent changing offsets');
assert.match(mapAnalysisService, /ControllerMapPreset/, 'local controller map preset model should exist');
assert.match(mapAnalysisService, /bytesBase64/, 'local presets should store bytes as base64');
assert.match(mapAnalysisService, /sha256/, 'local presets should store SHA-256');
assert.match(mapAnalysisService, /createControllerMapApplyPlan/, 'preset-to-target dry-run model should exist');
assert.match(mapAnalysisService, /backupRequired: true/, 'apply plan should require backup before a future write phase');
assert.match(mapAnalysisService, /targetPathAllowed/, 'apply dry-run should report whether the target path is allowed');
assert.match(mapAnalysisService, /allowed: byteLengthMatches && controllerKeyMatches && targetPathAllowed/, 'apply dry-run should require byte length, controllerKey, and target path matches');
assert.match(mapAnalysisService, /isControllerMapApplyTargetPath/, 'controller map apply target path guard should exist');
assert.match(mapAnalysisService, /\/media\/fat\/config\/inputs/, 'default apply target should be limited to /media/fat/config/inputs/*.map');
assert.match(mapAnalysisService, /ControllerMapPresetCandidate/, 'controller map preset candidate model should exist');
assert.match(mapAnalysisService, /ControllerMapPresetCandidateHashEntry/, 'controller candidate preparation should use hash-only entries');
assert.match(mapAnalysisService, /buildControllerMapPresetCandidates/, 'controller map preset candidates should be built by helper');
assert.match(mapAnalysisService, /`\$\{parsed\.controllerKey \|\| 'unknown'\}\|\$\{byteLength\}\|\$\{entry\.sha256\}`/, 'preset candidate groups should use controllerKey byteLength and sha256');
assert.match(mapAnalysisService, /byteLength === 2048/, '2048-byte map groups should be separated as exception groups');
assert.match(mapAnalysisService, /isRecommended = controllerKey !== 'unknown' && byteLength === 128 && files\.length >= minFileCount/, 'recommended candidates should prioritize known 128-byte groups with enough files');
assert.match(mapAnalysisService, /'arcade-common'/, 'controller preset types should include an Arcade Common option');
assert.match(mapAnalysisService, /Arcade Common/, 'controller preset labels should expose Arcade Common');
assert.match(mapAnalysisService, /createControllerMapPresetFromCandidate/, 'representative SHA group should be saveable as a local preset');
assert.match(mapAnalysisService, /sha256 !== candidate\.sha256/, 'candidate preset save should verify representative hash before storing bytes');
assert.match(mapAnalysisService, /does not infer A\/B\/X\/Y|Unknown \/ mixed arcade|Capcom CPS fighting 6-button/, 'candidate family labels should not infer button meanings');
assert.match(page, /프리셋 후보/, 'controller page should expose a preset candidate section');
assert.match(page, /preparePresetCandidates/, 'controller page should prepare preset candidates on demand');
assert.match(page, /candidateHashEntries/, 'controller page should store candidate hash entries separately from full byte exports');
assert.match(page, /sha256: result\.ok \? result\.sha256 : undefined/, 'candidate preparation should keep SHA only instead of retaining full read results');
assert.match(page, /saveCandidateAsPreset/, 'controller page should save a representative candidate as a preset');
assert.match(page, /openCandidateSaveModal/, 'candidate save button should open an in-app save modal');
assert.match(page, /candidateSaveModal/, 'controller page should keep selected candidate group in modal state');
assert.match(page, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-label=/, 'candidate save should render an accessible modal dialog');
assert.match(page, /defaultPresetNameForCandidate/, 'candidate modal should derive a default preset name from family and controller key');
assert.match(page, /defaultPresetTypeForCandidate/, 'candidate modal should derive a default preset type from the family guess');
assert.match(page, /candidateSaveName/, 'candidate modal should expose a preset name field');
assert.match(page, /candidateSaveType/, 'candidate modal should expose a preset type field');
assert.match(page, /candidateSaveNotes/, 'candidate modal should expose notes');
assert.match(page, /candidateSaveRepresentativePath/, 'candidate modal should expose representative file selection');
assert.match(page, /controllerDesktopService\.readFile\(activeProfile\?\.profileId, representative\.path\)/, 'candidate save should read only the selected representative map file');
assert.match(page, /createControllerMapPresetFromCandidate\(candidate, representative, result/, 'candidate save should verify the representative hash before storing');
assert.match(page, /candidateDuplicatePreset/, 'candidate save should detect duplicate controllerKey type sha256 presets');
assert.match(page, /candidateSaveDuplicateMode/, 'candidate save should let users replace or save a duplicate as a copy');
assert.match(page, /presetId: candidateDuplicatePreset\.presetId/, 'replace duplicate mode should preserve the existing preset id');
assert.match(page, /setCandidateSaveError/, 'candidate save failures should be shown in the modal');
assert.match(page, /setPresets\(savedPresets\)/, 'candidate save should refresh the local preset list immediately');
assert.match(page, /status-text success/, 'saved candidate rows should show a saved badge');
assert.match(page, /event\.stopPropagation\(\)/, 'candidate save click should not be swallowed by row event propagation');
assert.doesNotMatch(page, /onClick=\{\(\) => void saveCandidateAsPreset\(candidate\)\}/, 'candidate save button must not use the old prompt path');
assert.match(page, /lastPresetSaveAction/, 'developer diagnostics should include last preset save action');
assert.match(page, /candidate\.byteLength === 2048/, 'controller page should exclude 2048-byte exception groups from default preset saves');
assert.match(page, /대표 \.map bytes 하나만 로컬 프리셋으로 저장/, 'candidate UI should explain that only the representative map bytes are saved');
assert.match(page, /map 분석/, 'controller page should expose a map analysis section');
assert.match(page, /2개 파일 비교/, 'controller page should let users compare two map files');
assert.match(page, /같은 조이스틱 파일 비교/, 'controller page should support same-controller multi comparison');
assert.match(page, /선택한 \.map을 프리셋으로 저장/, 'controller page should allow saving a selected map as a local preset');
assert.match(page, /적용 준비 dry-run/, 'controller page should expose preset apply dry-run only');
assert.match(page, /실제 저장 버튼은 아직 비활성 단계/, 'controller page should keep real remote apply disabled');

assert.match(mapExportService, /ControllerMapAnalysisExport/, 'controller map export model should exist');
assert.match(mapExportService, /schemaVersion: 1/, 'controller map export should include a schema version');
assert.match(mapExportService, /mapFileCount/, 'controller map export should include summary counts');
assert.match(mapExportService, /ControllerMapAnalysisExportMode = 'summary' \| 'hash' \| 'full'/, 'controller map export should define summary hash and full modes');
assert.match(mapExportService, /includesFullBytes/, 'controller map export should report whether full bytes are included');
assert.match(mapExportService, /controllerGroupCount/, 'controller map export should include controller group counts');
assert.match(mapExportService, /gameKeyCount/, 'controller map export should include game group counts');
assert.match(mapExportService, /sha256GroupCount/, 'controller map export should include sha256 group counts');
assert.match(mapExportService, /byteLengthGroups/, 'controller map export should include byte length groups');
assert.match(mapExportService, /platformGroupCount/, 'controller map export should include platform groups');
for (const field of ['fileName', 'gameKey', 'controllerKey', 'byteLength', 'sha256', 'bytesBase64', 'decimalBytes', 'matchedPlatform', 'platformGuess', 'platformConfidence']) {
  assert.match(mapExportService, new RegExp(field), `controller map export files should include ${field}`);
}
assert.match(mapExportService, /mode === 'full' \? mapFileBytesFromReadResult\(readResult\) : undefined/, 'controller map export should only decode full bytes in full mode');
assert.match(mapExportService, /bytesBase64: mode === 'full'/, 'default exports should not include base64 bytes');
assert.match(mapExportService, /decimalBytes: bytes && bytes\.length <= 2048/, 'decimal bytes should only be derived from full-mode bytes');
assert.match(mapExportService, /hex: bytes && bytes\.length <= 2048/, 'hex should only be derived from full-mode bytes');
assert.match(mapExportService, /sha256: readResult\?\.sha256 \|\| null/, 'summary mode should allow missing SHA-256 without placeholder hashes');
assert.match(mapExportService, /groupByControllerKey/, 'controller map export should group by controller key');
assert.match(mapExportService, /groupByGameKey/, 'controller map export should group by game key');
assert.match(mapExportService, /groupBySha256/, 'controller map export should group by SHA-256');
assert.match(mapExportService, /groupByByteLength/, 'controller map export should group by byte length');
assert.match(mapExportService, /groupByPlatform/, 'controller map export should group by platform');
assert.match(mapExportService, /NeoGeo/, 'controller map export should include a conservative NEOGEO platform guess');
assert.match(mapExportService, /platformConfidence: 'none'/, 'unknown platform guesses should keep none confidence');
assert.match(mapExportService, /matchedPlatform is separate from platformGuess/, 'export notes should keep matched platform separate from platform guesses');
assert.match(mapExportService, /csvCell/, 'controller map export should escape CSV cells');
assert.match(mapExportService, /controller-map-analysis\.json/, 'ZIP export should include controller-map-analysis.json');
assert.match(mapExportService, /controller-map-files\.csv/, 'ZIP export should include file CSV');
assert.match(mapExportService, /controller-map-groups-controller\.csv/, 'ZIP export should include controller group CSV');
assert.match(mapExportService, /controller-map-groups-game\.csv/, 'ZIP export should include game group CSV');
assert.match(mapExportService, /controller-map-groups-sha256\.csv/, 'ZIP export should include sha256 group CSV');
assert.match(mapExportService, /controller-map-groups-platform\.csv/, 'ZIP export should include platform group CSV');
assert.match(mapExportService, /README\.txt/, 'ZIP export should include README.txt');
assert.match(mapExportService, /Upload this ZIP to ChatGPT/, 'export README should explain ChatGPT upload use');
assert.match(mapExportService, /does not infer A\/B\/X\/Y/, 'export README should explain that byte values are not button names');
assert.match(mapExportService, /passwords, private keys, passphrases, and tokens are intentionally not included/i, 'export notes should state that secrets are excluded');
assert.doesNotMatch(mapExportService, /password\s*:/i, 'export model must not include password fields');
assert.doesNotMatch(mapExportService, /privateKey\s*:/i, 'export model must not include privateKey fields');
assert.doesNotMatch(mapExportService, /passphrase\s*:/i, 'export model must not include passphrase fields');
assert.doesNotMatch(mapExportService, /token\s*:/i, 'export model must not include token fields');
assert.doesNotMatch(mapExportService, /C:\\\\Users/i, 'export service must not embed local Windows user paths');
assert.match(page, /exportControllerMapAnalysis\('zip', 'hash'\)/, 'controller page should render a lightweight hash ZIP export button');
assert.match(page, /exportControllerMapAnalysis\('summary', 'summary'\)/, 'controller page should render a metadata-only export button');
assert.match(page, /exportControllerMapAnalysis\('zip', 'full', 'selected-group'\)/, 'controller page should render a selected full bytes export button');
assert.match(page, /exportControllerMapAnalysis\('zip', 'full', 'all'\)/, 'controller page should render an advanced all-bytes export button');
assert.match(page, /window\.confirm\(`전체 \$\{mapFiles\.length\}개 \.map 파일 bytes/, 'full all export should require a warning modal');
assert.match(page, /cancelControllerMapExport/, 'controller page should expose export cancellation');
assert.match(page, /buildCurrentMapExport/, 'controller page should build an export from current map files');
assert.match(page, /controllerDesktopService\.readFile\(activeProfile\?\.profileId, file\.path\)/, 'controller export should read map files through the existing read-only controller IPC');
assert.match(page, /if \(mode === 'summary'\)[\s\S]*원격 파일 bytes는 읽지 않습니다/, 'summary export should not read remote file bytes');
assert.match(page, /controllerMapExportReadConcurrency = 8/, 'hash and full exports should use a conservative concurrency limit');
assert.match(page, /controllerMapExportReadTimeoutMs = 8_000/, 'controller map export should have a per-file read timeout');
assert.match(page, /Promise\.race\(\[\s*controllerDesktopService\.readFile\(activeProfile\?\.profileId, file\.path\),\s*createMapExportReadTimeout\(file\),\s*\]\)/s, 'controller map export should not hang forever on one stuck read');
assert.match(page, /CONTROLLER_MAP_EXPORT_READ_TIMEOUT/, 'controller map export should mark timed-out files clearly');
assert.match(page, /metadata만 포함/, 'controller map export should continue with metadata-only entries when a file read times out');
assert.match(page, /\$\{completedCount\}\/\$\{total\}/, 'controller map export should show mode-specific read progress');

const controllerSectionStart = main.indexOf('const controllerCandidateDirs');
const controllerSectionEnd = main.indexOf('function createRomFsError', controllerSectionStart);
assert.notEqual(controllerSectionStart, -1, 'controller main adapter section should exist');
assert.notEqual(controllerSectionEnd, -1, 'controller main adapter section should end before the ROM adapter');
const controllerMainSection = main.slice(controllerSectionStart, controllerSectionEnd);
assert.match(controllerMainSection, /controllerFsRestoreBackup/, 'controller main adapter section should include restore handling');
// The controller live-input + inventory features read device/config files over SSH via controlled, read-only
// `cat` commands (e.g. `timeout 600 cat /dev/hidraw…`, `cat /proc/bus/input/devices`, `cat "<mra>"`). Those are
// allowed. What must NOT appear: a raw/command/exec IPC handler, a local process spawn, or a WRITE/destructive
// SSH command.
assert.doesNotMatch(controllerMainSection, /ipcMain\.handle\(['"](?:raw|command|exec)/i, 'controller section must not expose a raw/command/exec IPC handler');
assert.doesNotMatch(controllerMainSection, /\bexecFile\b/, 'controller section must not spawn local processes');
assert.doesNotMatch(controllerMainSection, /client\.exec\(\s*[`'"][^`'"]*(?:\brm\b|\bmv\b|\bcp\b|\bdd\b|\bmkfs\b|\bchmod\b|\bchown\b|\breboot\b|\bshutdown\b|\bbash\b|>>|>)/i, 'controller SSH exec must stay read-only (no write/destructive commands)');
assert.match(controllerMainSection, /client\.exec\(`timeout 600 cat /, 'controller live-input reads a device node via a controlled, timeout-capped cat');
assert.doesNotMatch(preload, /rawCommand|executeCommand|sshExec|remoteWrite/i, 'preload must not expose raw command or unrestricted remote write APIs');
assert.match(packageJson.scripts.test, /test:phase-twenty-five/, 'main test script should include controller management tests');

const smoke = read('scripts/smoke-electron-render.mjs');
assert.match(smoke, /controllerFsScanInventory/, 'Electron smoke test should invoke controller scan IPC directly');
assert.match(smoke, /No handler registered/, 'Electron smoke test should fail if controller scan IPC handler is missing');

console.log('phase twenty-five controller management tests passed.');
