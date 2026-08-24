import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const typesSource = readFileSync(new URL('../src/types/ini.ts', import.meta.url), 'utf8');
const fileNameSource = readFileSync(new URL('../src/services/ini/iniFileNameService.ts', import.meta.url), 'utf8');
const parserSource = readFileSync(new URL('../src/services/ini/iniParser.ts', import.meta.url), 'utf8');
const helpSource = readFileSync(new URL('../src/services/ini/iniHelpCatalog.ts', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../src/pages/IniSettingsRealPage.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const mainTsxSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const desktopTypesSource = readFileSync(new URL('../src/types/desktop.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');

for (const fileName of ['MiSTer.ini', 'MiSTer_alt_1.ini', 'MiSTer_alt_2.ini', 'MiSTer_alt_3.ini']) {
  assert.ok(fileNameSource.includes(fileName), `${fileName} should be explicitly allowed`);
}

const safeIniNameBodyPattern = fileNameSource.match(/safeIniNameBodyPattern = '([^']+)'/)?.[1];
const assertAllowedIniFileNameSource = fileNameSource.match(/export function assertAllowedIniFileName[\s\S]*?\n}/)?.[0] || '';
assert.ok(safeIniNameBodyPattern, 'INI filename service should expose a shared safe name body pattern');
assert.ok(safeIniNameBodyPattern.includes('()'), 'safe custom MiSTer INI names should allow parentheses');
const customIniNamePattern = new RegExp(`^MiSTer_${safeIniNameBodyPattern}\\.ini$`, 'i');
const altIniNamePattern = new RegExp(`^MiSTer_alt_${safeIniNameBodyPattern}\\.ini$`, 'i');
function candidateAllowed(fileName) {
  const normalized = String(fileName || '').trim().replace(/\\/g, '/').split('/').pop() || '';
  const allowedName = /^MiSTer\.ini$/i.test(normalized) || altIniNamePattern.test(normalized) || customIniNamePattern.test(normalized);
  return allowedName
    && normalized === String(fileName || '').trim()
    && /\.ini$/i.test(normalized)
    && !normalized.includes('..')
    && !/[<>:"|?*]/.test(normalized)
    && !Array.from(normalized).some((char) => char.charCodeAt(0) < 32);
}
function trashCandidateAllowed(fileName) {
  return candidateAllowed(fileName) && !/^MiSTer\.ini$/i.test(String(fileName || '').trim());
}
for (const fileName of ['MiSTer_NM.ini', 'MiSTer_CRT.ini', 'MiSTer_example.ini', 'MiSTer_custom video (CRT).ini', 'MiSTer_alt_1.ini', 'MiSTer_alt_3.ini', 'MiSTer.ini']) {
  assert.ok(candidateAllowed(fileName), `${fileName} should be allowed by the shared INI filename pattern`);
}
for (const fileName of ['Other.ini', 'MiSTer.txt', '../MiSTer_NM.ini', 'MiSTer_bad/name.ini', 'MiSTer_bad\\name.ini', 'MiSTer_bad..name.ini']) {
  assert.ok(!candidateAllowed(fileName), `${fileName} should be blocked by the shared INI filename pattern`);
}
for (const fileName of ['MiSTer_NM.ini', 'MiSTer_CRT.ini', 'MiSTer_example.ini', 'MiSTer_alt_1.ini', 'MiSTer_alt_3.ini']) {
  assert.ok(trashCandidateAllowed(fileName), `${fileName} should be allowed to move into the restricted INI trash`);
}
assert.ok(!trashCandidateAllowed('MiSTer.ini'), 'MiSTer.ini should be allowed as a file but blocked from trash/delete');
const trashRemotePathPattern = /\/[0-9]{8}-[0-9]{6}-MiSTer.*\.ini$/i;
assert.ok(trashRemotePathPattern.test('/media/fat/.hello-mister-trash/ini/20260608-153000-MiSTer_NM.ini'), 'MiSTer_NM.ini trash target should pass the restricted trash path pattern');
const backupRoot = '/media/fat/.hello-mister-backups/ini';
const trashRoot = '/media/fat/.hello-mister-trash/ini';
function backupPathAllowed(originalFileName, backupPath) {
  const escaped = originalFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return backupPath.startsWith(`${backupRoot}/${originalFileName}/`)
    && (new RegExp(`${escaped}/[0-9]{8}-[0-9]{6}\\.ini$`).test(backupPath)
      || new RegExp(`${escaped}/[0-9]{8}-[0-9]{6}-${escaped}$`).test(backupPath))
    && !backupPath.includes('..');
}
function trashPathAllowed(trashPath) {
  return trashPath.startsWith(`${trashRoot}/`)
    && /^[0-9]{8}-[0-9]{6}-MiSTer.*\.ini$/i.test(trashPath.slice(`${trashRoot}/`.length))
    && !trashPath.includes('..');
}
assert.ok(backupPathAllowed('MiSTer_NM.ini', '/media/fat/.hello-mister-backups/ini/MiSTer_NM.ini/20260608-153012.ini'), 'timestamp-only MiSTer_NM.ini backup path should be allowed');
assert.ok(backupPathAllowed('MiSTer_NM.ini', '/media/fat/.hello-mister-backups/ini/MiSTer_NM.ini/20260608-153012-MiSTer_NM.ini'), 'timestamp-prefixed MiSTer_NM.ini backup path should be allowed');
assert.ok(trashPathAllowed('/media/fat/.hello-mister-trash/ini/20260608-153012-MiSTer_NM.ini'), 'timestamp-prefixed MiSTer_NM.ini trash path should be allowed');
assert.ok(!trashPathAllowed('/media/fat/.hello-mister-trash/ini/../20260608-153012-MiSTer_NM.ini'), 'path traversal trash path should be blocked');
assert.ok(!backupPathAllowed('MiSTer_NM.ini', '/media/fat/.hello-mister-backups/ini/MiSTer_NM.ini/../20260608-153012.ini'), 'path traversal backup path should be blocked');
assert.ok(fileNameSource.includes('allowedCustomIniNamePattern'), 'custom MiSTer_*.ini names should be accepted by a named pattern');
assert.ok(fileNameSource.includes('invalidIniFileNameMessage'), 'renderer validator should use a single clear invalid filename message');
assert.ok(mainSource.includes('invalidIniFileNameMessage'), 'Electron main validator should use the same clear invalid filename message');
assert.ok(fileNameSource.includes('MiSTer_alt_1.ini, MiSTer_alt_2.ini, MiSTer_alt_3.ini, MiSTer_이름.ini'), 'invalid filename message should name exact alt slots and custom MiSTer_*.ini files');
assert.ok(assertAllowedIniFileNameSource.includes('if (!isAllowedIniFileName(fileName))'), 'assertAllowedIniFileName should validate the original input before returning the basename');
assert.ok(!assertAllowedIniFileNameSource.includes('isAllowedIniFileName(normalized))'), 'assertAllowedIniFileName should not allow traversal by validating only the normalized basename');
assert.ok(mainSource.includes(`safeIniNameBodyPattern = '${safeIniNameBodyPattern}'`), 'Electron main should use the same safe INI filename body pattern');
assert.ok(fileNameSource.includes('/\\.ini$/i'), '.INI extensions should be handled case-insensitively');
assert.ok(fileNameSource.includes('isSafeIniDisplayFileName'), 'local imported INI display names should have a safe filename guard');
assert.ok(fileNameSource.includes('suggestedRemoteIniFileName'), 'local imports should have a suggested allowed remote filename');
assert.ok(fileNameSource.includes('canTrashIniFile'), 'MiSTer.ini delete guard should be exposed');
assert.ok(fileNameSource.includes("classifyIniFile(fileName) !== 'main'"), 'main MiSTer.ini should not be trashable');
assert.ok(pageSource.includes('canTrashIniFile(targetFileName)'), 'remote trash action should use the shared INI filename delete guard');
assert.ok(mainSource.includes("if (/^MiSTer\\.ini$/i.test(fileName)) return { ok: false"), 'Electron main should still block MiSTer.ini trash');
assert.ok(mainSource.includes('sftpRename(sftp, sourcePath, trashPath)'), 'custom MiSTer INI trash should move through restricted SFTP rename');

for (const key of ['video_mode', 'vsync_adjust', 'vscale_mode', 'direct_video', 'volume', 'refresh_min', 'refresh_max']) {
  assert.ok(helpSource.includes(key), `${key} help entry should exist`);
}
for (const [labelEn, labelKo] of [
  ['Composite Sync', '컴포지트 싱크'],
  ['Direct Video', '다이렉트 비디오'],
  ['VGA Mode', 'VGA 모드'],
  ['Menu Key as RGUI', '메뉴 키 RGUI 동작'],
]) {
  assert.ok(helpSource.includes(`labelEn: '${labelEn}'`) && helpSource.includes(`labelKo: '${labelKo}'`), `${labelEn} (${labelKo}) should be available for display`);
}
assert.ok(helpSource.includes('labelEn') && helpSource.includes('labelKo'), 'help catalog should store English and Korean labels separately');
assert.ok(helpSource.includes('descriptionKo'), 'help catalog should store Korean descriptions');
assert.ok(helpSource.includes('whenToUseKo'), 'help catalog should explain when to use settings');
assert.ok(helpSource.includes('valueGuideKo'), 'help catalog should expose value/range guidance');
assert.ok(helpSource.includes('recommendedKo'), 'help catalog should expose recommendation guidance');
assert.ok(helpSource.includes('warningKo'), 'help catalog should expose caution guidance');
assert.ok(helpSource.includes('source: MisterIniHelpSource'), 'help catalog entries should expose official source metadata');
assert.ok(helpSource.includes("source: input.source || 'official-mister-ini'"), 'help catalog entries should default to official MiSTer.ini source');
assert.ok(helpSource.includes('allowedValues'), 'help catalog should expose allowed enum values');
assert.ok(helpSource.includes('range: { min: 1, max: 399 }'), 'vscale_border should expose a 1-399 range');
assert.ok(helpSource.includes("placeholder: '예: 0x18d80002'"), 'keyrah_mode should expose a hex placeholder');
assert.ok(helpSource.includes("placeholder: '0-14 또는 custom modeline'"), 'video_mode should expose video mode placeholder guidance');
assert.ok(helpSource.includes("riskLevel: 'danger'") && helpSource.includes("riskLevel: 'caution'"), 'risky video output settings should have risk badges');
assert.ok(helpSource.includes('OFF=0, ON=1로 저장됩니다.'), 'boolean help should explain saved 0/1 values');

const naturalKoreanIniHelpPhrases = [
  ['key_menu_as_rgui', 'MiSTer의 메뉴 키를 일부 코어에서 RGUI 키처럼 동작하게 하는 설정입니다.'],
  ['forced_scandoubler', 'VGA 출력에서 스캔더블러를 항상 사용하도록 강제하는 설정입니다.'],
  ['vga_mode', 'VGA/아날로그 출력의 신호 형식을 정하는 설정입니다.'],
  ['ntsc_mode', 'S-Video나 Composite Video 출력에서 사용하는 NTSC/PAL 계열 컬러 방식을 정하는 설정입니다.'],
  ['composite_sync', '아날로그 출력에서 수평/수직 동기 신호를 하나의 composite sync 신호로 사용할지 정하는 설정입니다.'],
  ['vga_scaler', 'VGA 출력에 스케일러 처리를 적용할지 정하는 설정입니다.'],
  ['hdmi_audio_96k', 'HDMI 오디오 샘플링을 96kHz로 출력할지 정하는 설정입니다.'],
  ['keyrah_mode', 'Keyrah 같은 특수 키보드 어댑터를 사용할 때 장치 식별값을 지정하는 설정입니다.'],
  ['vscale_mode', '화면을 세로 방향으로 어떻게 확대하거나 맞출지 정하는 설정입니다.'],
  ['vscale_border', '화면 위아래가 잘리거나 여백이 맞지 않을 때 세로 여백을 조정하는 설정입니다.'],
  ['rbf_hide_datecode', '코어 파일명에 포함된 날짜 코드 표시를 숨길지 정하는 설정입니다.'],
  ['menu_pal', 'MiSTer 메뉴 화면을 PAL 방식으로 표시할지 정하는 설정입니다.'],
  ['hdmi_limited', 'HDMI 색 범위를 제한 범위로 출력할지 정하는 설정입니다.'],
  ['direct_video', 'HDMI 출력 타이밍을 이용해 아날로그 변환 장치에서 코어의 원래 비디오 타이밍을 사용하게 하는 설정입니다.'],
  ['hdr', 'HDR 출력을 사용할지 정하는 설정입니다.'],
  ['fb_size', 'Linux framebuffer 크기를 조정하는 설정입니다.'],
  ['fb_terminal', 'framebuffer terminal 표시 여부를 정하는 설정입니다.'],
  ['video_mode', 'MiSTer의 출력 해상도와 주사율을 정하는 핵심 영상 설정입니다.'],
  ['refresh_min', '가변 주사율 환경에서 사용할 최소 주사율을 지정하는 설정입니다.'],
  ['refresh_max', '가변 주사율 환경에서 사용할 최대 주사율을 지정하는 설정입니다.'],
];
for (const [key, phrase] of naturalKoreanIniHelpPhrases) {
  assert.ok(helpSource.includes(key) && helpSource.includes(phrase), `${key} should use manually written Korean INI help copy`);
}

assert.ok(parserSource.includes('parseIniDocument'), 'INI parser should parse real remote INI files');
assert.ok(parserSource.includes('pendingComments.join'), 'parser should attach adjacent comments as help');
assert.ok(parserSource.includes('splitInlineComment'), 'parser should split inline comments from setting values');
assert.ok(parserSource.includes('inlineComment: parsedValue.inlineComment'), 'parser should store inline comments separately from editable values');
assert.ok(parserSource.includes('commentDelimiter: parsedValue.commentDelimiter'), 'parser should remember inline comment delimiters');
assert.ok(parserSource.includes('serializeIniDocument'), 'INI serializer should preserve raw lines around edited settings');
assert.ok(parserSource.includes('commentSuffix'), 'INI serializer should preserve inline comments after edited values');
assert.ok(parserSource.includes("if (!help || help.source === 'unknown') return 'text'"), 'catalog-missing INI values should not be guessed into typed controls');
assert.ok(parserSource.includes("help.valueType === 'boolean'"), 'catalog-confirmed boolean valueType should force boolean controls');
assert.ok(parserSource.includes("helpSource: catalog?.source || 'unknown'"), 'parser should mark catalog-missing settings as unknown-source help');
assert.ok(parserSource.includes('labelEn: catalog?.labelEn'), 'parser should attach English labels');
assert.ok(parserSource.includes('labelKo: catalog?.labelKo'), 'parser should attach Korean labels');
assert.ok(parserSource.includes('allowedValues: catalog?.allowedValues'), 'parser should attach allowed values');
assert.ok(parserSource.includes('range: catalog?.range'), 'parser should attach range metadata');
assert.ok(parserSource.includes('placeholder: catalog?.placeholder'), 'parser should attach input placeholders');
assert.ok(parserSource.includes('riskLevel: catalog?.riskLevel'), 'parser should attach risk metadata');
assert.ok(typesSource.includes('MisterIniRemoteFile'), 'real INI remote file type should exist');
assert.ok(typesSource.includes('MisterIniBackupEntry'), 'INI backup type should exist');
assert.ok(typesSource.includes('MisterIniBackupPreviewResult'), 'INI backup preview result type should exist');
assert.ok(typesSource.includes('MisterIniFileSource'), 'INI files should expose source badges');
assert.ok(typesSource.includes('inlineComment?: string'), 'parsed INI settings should expose inline comments');
assert.ok(typesSource.includes('rawLine?: string'), 'developer mode should be able to inspect the original setting line');
assert.ok(typesSource.includes('labelEn?: string') && typesSource.includes('labelKo?: string'), 'parsed settings should expose English/Korean labels');
assert.ok(typesSource.includes('MisterIniAllowedValue'), 'parsed settings should expose allowed value metadata');
assert.ok(typesSource.includes('MisterIniValueRange'), 'parsed settings should expose value range metadata');
assert.ok(typesSource.includes('MisterIniRiskLevel'), 'parsed settings should expose risk level metadata');
assert.ok(typesSource.includes('MisterIniHelpSource'), 'parsed settings should expose official help source metadata');
assert.ok(typesSource.includes('helpSource?: MisterIniHelpSource'), 'parsed settings should carry each setting help source');
assert.ok(typesSource.includes('MisterIniIndexDebug'), 'remote INI refresh should expose developer-only listing diagnostics');
assert.ok(typesSource.includes('rawMediaFatItemCount'), 'remote INI diagnostics should include raw /media/fat item count');
assert.ok(typesSource.includes('localContent'), 'local imported INI content should be represented in metadata');
assert.ok(typesSource.includes('MisterIniWriteCapabilityResult'), 'INI write capability result type should exist');
assert.ok(typesSource.includes("'connectedWritable'"), 'INI write capability should expose a connectedWritable state');
assert.ok(typesSource.includes("'writeCheckFailed'"), 'INI write capability should expose a writeCheckFailed state');
assert.ok(typesSource.includes('phase?: string'), 'INI operation results should expose safe failure phases');
assert.ok(typesSource.includes('sanitizedDetail?: string'), 'INI operation results should expose sanitized failure details');

assert.ok(mainTsxSource.includes('IniSettingsRealPage'), '/ini route should use the real INI page');
assert.ok(!pageSource.includes('HDMI 기본 보기'), 'old HDMI default card should not be in the real INI page');
assert.ok(!pageSource.includes('변경점 비교'), 'large diff comparison panel should not be in the real INI page');
assert.ok(pageSource.includes('저장 버튼을 누르기 전까지 원격 INI는 수정되지 않습니다.'), 'page should state no autosave policy');
assert.ok(pageSource.includes('sourceLabel'), 'page should render INI source labels');
assert.ok(pageSource.includes('iniSourceDisplayLabel'), 'page should render user-facing INI source labels');
assert.ok(pageSource.includes('MiSTer에서 읽음'), 'remote INI source should be shown as read from the connected MiSTer');
assert.ok(pageSource.includes('INI 편집 가능'), 'page should show INI write capability in user-facing status');
assert.ok(pageSource.includes('MisterIniDesktopService.checkWriteCapability'), 'page should check INI write capability for the active MiSTer');
assert.ok(pageSource.includes('const iniWritable'), 'page should gate remote INI write workflows on INI write capability');
assert.ok(pageSource.includes('현재 MiSTer의 /media/fat에서 MiSTer*.ini 파일을 찾지 못했습니다.'), 'empty remote INI refresh should explain the active MiSTer /media/fat search');
assert.ok(pageSource.includes('index.debug'), 'developer mode should expose remote INI refresh debug counts');
assert.ok(pageSource.includes('iniFileListKey'), 'remote and local INI entries with the same filename should remain selectable as separate list rows');
assert.ok(pageSource.includes('원격') && pageSource.includes('로컬') && pageSource.includes('업로드 준비'), 'page should show remote/local/upload-ready source badges');
assert.ok(pageSource.includes('현재 보고 있는 파일') && pageSource.includes('출처:') && pageSource.includes('MiSTer:'), 'selected INI summary should show target and source');
assert.ok(pageSource.includes("'ON'") && pageSource.includes("'OFF'"), 'boolean values should render as ON/OFF toggles');
assert.ok(pageSource.includes('setting.inlineComment'), 'inline comments should be available as hover help instead of becoming input values');
assert.ok(pageSource.includes('settingDisplayLabel'), 'page should render English + Korean setting labels');
assert.ok(pageSource.includes('settingHelpSections'), 'page should render structured help sections');
assert.ok(pageSource.includes('IniHelpPopover'), 'page should show hover/click help popovers');
assert.ok(pageSource.includes('HelpCircle'), 'page should use a recognizable help icon');
assert.ok(pageSource.includes('ini-help-popover'), 'page should include help popover markup');
assert.ok(pageSource.includes('pinnedHelpId'), 'click-pinned INI help should be tracked by a single active help id');
assert.ok(pageSource.includes('setPinnedHelpId((current) => (current === setting.id ? undefined : setting.id))'), 'clicking a help icon should toggle the same popover layer');
assert.ok(pageSource.includes('onPointerDown={(event) => event.stopPropagation()}'), 'clicks inside the help wrapper should not trigger outside-close or value changes');
assert.ok(pageSource.includes('aria-expanded={pinnedHelpId === setting.id}'), 'help icon should expose the pinned popover state');
assert.ok(!pageSource.includes('title={settingHelpText'), 'help icon/label should not use native title tooltips');
assert.ok(!pageSource.includes('function settingHelpText'), 'duplicate native tooltip text builder should be removed');
assert.ok(!pageSource.includes('title="클릭하면 값을 변경합니다'), 'toggle safety hint should not be shown as a native browser tooltip');
assert.ok(stylesSource.includes('.ini-help-wrapper:not(.help-mode-click):hover .ini-help-popover'), 'hover help should use the same popover layer only when no click-pinned help is open');
assert.ok(stylesSource.includes('.ini-help-wrapper.open .ini-help-popover'), 'click-pinned help should show the same popover layer');
assert.ok(pageSource.includes('fallbackIniHelpProfile'), 'catalog-missing INI keys should use the simplified fallback help message');
assert.ok(pageSource.includes('translatedIniComment'), 'original INI comments should be translated into the simplified Korean description');
assert.ok(pageSource.includes('이 항목은 현재 INI 파일에 포함된 설정입니다. 의미가 확실하지 않으면 기존 값을 유지하세요.'), 'comment-missing fallback should stay simple and user-friendly');
const removedHelpPhrases = [
  ['공식 문서 ', '미확인 ', '항목'].join(''),
  ['미확인 ', '항목'].join(''),
  ['출처 ', '미', '확인'].join(''),
  ['입력/변경 ', '방법'].join(''),
];
for (const phrase of removedHelpPhrases) {
  assert.ok(!pageSource.includes(phrase), `${phrase} should not be shown in help output`);
}
assert.ok(!pageSource.includes('official-docs') && !pageSource.includes('community-guide') && !pageSource.includes('confidence'), 'source/confidence labels should not be shown in help output');
assert.ok(!pageSource.includes('profile.purposeKo'), 'fallback help should use descriptionKo instead of the removed purposeKo field');
assert.ok(pageSource.includes('원본 주석'), 'original comments should remain in the same popover');
assert.ok(!pageSource.includes(["label: 'line", " number'"].join('')), 'debug line metadata should not be a basic help section');
assert.ok(pageSource.includes('OFF=0, ON=1로 저장됩니다.'), 'value guidance should explain saved 0/1 values');
assert.ok(!pageSource.includes('원본 주석을 기반으로 한 추정 설명입니다'), 'comment-based guessed help should be removed');
assert.ok(!pageSource.includes('미확인 영상 옵션'), 'keyword-based unknown video classifications should be removed');
assert.ok(!pageSource.includes('미확인 입력 옵션'), 'keyword-based unknown input classifications should be removed');
assert.ok(pageSource.includes('settingPlaceholder'), 'direct text/number inputs should have placeholder guidance');
assert.ok(pageSource.includes('ini-input-hint'), 'direct text/number inputs should show value hints');
assert.ok(pageSource.includes('setting.allowedValues'), 'select inputs should use allowed value metadata');
assert.ok(pageSource.includes('OFF=0, ON=1로 저장됩니다.'), 'boolean hover help should explain the saved 0/1 value');
assert.ok(pageSource.includes('data-toggle-safety="row-passive"'), 'INI setting rows should be passive and not toggle values by row click');
assert.ok(pageSource.includes('data-toggle-safety="control-only"'), 'INI values should change only through explicit controls');
assert.ok(pageSource.includes('event.stopPropagation()'), 'help and value controls should stop row-level click propagation');
assert.ok(pageSource.includes('id={inputId}') && pageSource.includes('htmlFor={inputId}'), 'boolean switch label should target only the checkbox control area');
assert.ok(!pageSource.includes('<label className="ini-switch"'), 'boolean switch should not wrap the whole control row in a label');
assert.ok(pageSource.includes('onChange={(event) => onChange(settingValueForToggle'), 'toggle dirty state should be driven by the checkbox onChange only');
assert.ok(pageSource.includes('settingHelpSections(setting, developerMode).map'), 'simplified Korean help and original comments should live inside the single popover');
assert.ok(pageSource.includes('riskLabel(setting)') && pageSource.includes('riskTone(setting)'), 'risky video settings should show risk badges');
assert.ok(!pageSource.includes("developerMode && setting.rawLine"), 'raw INI lines should not appear in the simplified help popover');
assert.ok(pageSource.includes('formatBackupRestoreWarning'), 'backup restore warning should be shown before overwrite');
assert.ok(pageSource.includes('previewBackup(backup)'), 'backup rows should expose a preview action');
assert.ok(pageSource.includes('백업 미리보기'), 'backup preview modal should be rendered');
assert.ok(pageSource.includes('이 백업으로 복원'), 'backup preview should allow explicit restore after review');
assert.ok(pageSource.includes('현재 원격 INI가 백업 내용으로 덮어씌워집니다'), 'restore preview should warn that current INI will be overwritten');
assert.ok(pageSource.includes('기본 MiSTer.ini는 삭제할 수 없습니다.'), 'main MiSTer.ini delete should remain blocked in the UI');
assert.ok(pageSource.includes('ini-manager-layout two-pane'), 'INI page should use the simplified two-pane layout');
assert.ok(pageSource.includes('ini-pane-splitter'), 'INI list/editor splitter should be rendered');
assert.ok(pageSource.includes('hello-mister-ini-list-width'), 'INI list pane width should be persisted');
assert.ok(!pageSource.includes('title="이름 / 프리셋 / 백업"'), 'old right-side name/preset/backup panel should be removed');
assert.ok(pageSource.includes('ini-file-inline-editor'), 'INI metadata should be edited inside the INI list');
assert.ok(pageSource.includes('saveNotesMetadata'), 'INI memo edits should save appData metadata without modifying remote INI content');
assert.ok(!pageSource.includes('setDisplayName'), 'default INI list should not expose display name editing');
assert.ok(!pageSource.includes('setPresetSlot'), 'default INI list should not expose preset-slot editing');
assert.ok(!pageSource.includes('select value={presetSlot}'), 'preset slot editor should be hidden from the default INI list');
assert.ok(pageSource.includes('INI 메모를 저장했습니다. 원격 INI 파일은 변경하지 않았습니다.'), 'memo save should make clear that the remote INI file is not changed');
assert.ok(pageSource.includes('disabled={!iniWritable'), 'save and backup controls should still disable when INI write capability is missing');
assert.ok(pageSource.includes('deleteIniBySource(file)'), 'INI delete action should branch by list item source');
assert.ok(pageSource.includes('isRemoteIniSource(file.source)'), 'remote INI delete should use the remote source branch');
assert.ok(pageSource.includes('removeLocalIniEntry(file)'), 'local/upload/cache INI delete should remove appData list entries');
assert.ok(pageSource.includes('iniDeleteDisabledReason(file);'), 'remote INI delete should not be blocked by the write-capability precheck');
assert.ok(!pageSource.includes('iniDeleteDisabledReason(file, iniWritable)'), 'remote INI trash should not require stale iniWritable state before calling the restricted IPC');
assert.ok(!pageSource.includes('INI 휴지통 복구 권한을 확인하지 못했습니다.'), 'trash restore should be allowed to reach the restricted IPC and report real errors');
assert.ok(!pageSource.includes('INI 휴지통 삭제 권한을 확인하지 못했습니다.'), 'trash permanent delete should be allowed to reach the restricted IPC and report real errors');
assert.ok(pageSource.includes('trashActionPendingKey'), 'remote INI trash confirm should enter a visible pending state');
assert.ok(pageSource.includes('휴지통 폴더 생성 후 SFTP rename을 실행합니다.'), 'remote INI trash should show concrete progress after confirmation');
assert.ok(pageSource.includes('MisterIniDesktopService.trashIni({ profileId, fileName: targetFileName, confirmed: true })'), 'remote INI trash confirm should execute the restricted trash IPC');
assert.ok(pageSource.includes('removeIniFileFromList(file)'), 'remote INI trash success should remove the file from the normal INI list immediately');
assert.ok(pageSource.includes('setTrashPanelOpen(true)'), 'remote INI trash success should open the trash panel');
assert.ok(pageSource.includes('MisterIniDesktopService.listTrash(nextProfileId)'), 'remote INI trash success should refresh the trash list');
assert.ok(pageSource.includes('파일을 휴지통으로 이동하지 못했습니다'), 'remote INI trash failure should show a Korean error message');
assert.ok(pageSource.includes('metadataEntryMatchesFile'), 'metadata removal should target the selected source/file pair');
assert.ok(pageSource.includes('목록에서 제거'), 'local/upload/cache INI entries should use a list removal action label');
assert.ok(pageSource.includes('기본 INI 파일은 삭제할 수 없습니다.'), 'remote MiSTer.ini delete should remain disabled with a clear reason');
assert.ok(pageSource.includes('로컬/업로드 준비/cache 항목은 MiSTer가 아니라 앱 목록에서 제거됩니다.'), 'local source delete copy should not imply remote trash movement');
assert.ok(pageSource.includes('선택한 INI 백업') && pageSource.includes('<strong>휴지통</strong>'), 'backup and trash lists should live under the INI file list');
assert.ok(pageSource.includes('deleteBackup(backup)'), 'backup rows should expose a restricted delete action');
assert.ok(pageSource.includes('deleteTrash(entry)'), 'trash rows should expose a restricted permanent delete action');
assert.ok(!pageSource.includes('INI 전용 제한 쓰기'), 'top target area should not show internal write-scope badges');
assert.ok(!pageSource.includes('원격 INI ${index.debug.remoteIniCandidateCount}개'), 'top target area should not show remote debug counts');

for (const api of [
  'iniFsCheckWriteCapability',
  'iniFsListRemoteIni',
  'iniFsReadRemoteIni',
  'iniFsWriteRemoteIniWithBackup',
  'iniFsListBackups',
  'iniFsPreviewBackup',
  'iniFsRestoreBackup',
  'iniFsDeleteBackup',
  'iniFsTrashIni',
  'iniFsListTrash',
  'iniFsRestoreTrashedIni',
  'iniFsDeleteTrashedIni',
  'iniFsExportIniLocal',
  'iniFsImportIniLocal',
]) {
  assert.ok(desktopTypesSource.includes(api), `${api} desktop type should exist`);
  assert.ok(preloadSource.includes(api), `${api} should be exposed through preload`);
}

for (const channel of [
  'iniFs:checkWriteCapability',
  'iniFs:listRemoteIni',
  'iniFs:readRemoteIni',
  'iniFs:writeRemoteIniWithBackup',
  'iniFs:listBackups',
  'iniFs:previewBackup',
  'iniFs:restoreBackup',
  'iniFs:deleteBackup',
  'iniFs:trashIni',
  'iniFs:listTrash',
  'iniFs:restoreTrashedIni',
  'iniFs:deleteTrashedIni',
]) {
  assert.ok(mainSource.includes(channel), `${channel} IPC should exist`);
}

assert.ok(mainSource.includes("'/media/fat/MiSTer.ini'"), 'main INI path should be explicit');
assert.ok(mainSource.includes("'/media/fat/.hello-mister-backups/ini'"), 'remote INI backup root should be explicit');
assert.ok(mainSource.includes("'/media/fat/.hello-mister-trash/ini'"), 'remote INI trash root should be explicit');
assert.ok(mainSource.includes("'.hello-mister-ini-write-check.tmp'"), 'INI write capability check should use a fixed internal temp file name');
assert.ok(mainSource.includes('function assertIniRootWritePath'), 'root INI files should have a dedicated path validator');
assert.ok(mainSource.includes('function assertIniBackupWritePath'), 'INI backup files should have a dedicated path validator');
assert.ok(mainSource.includes('function assertIniTrashWritePath'), 'INI trash files should have a dedicated path validator');
assert.ok(!mainSource.includes('function assertIniWritePath'), 'INI operations should call scope-specific path validators instead of a mixed dispatcher');
assert.ok(mainSource.includes('backupFileNameMatchesOriginal'), 'INI backup validator should allow timestamped backup files derived from the original INI name');
assert.ok(mainSource.includes('trashFileNameToOriginal'), 'INI trash validator should recover and validate the original INI filename from timestamped trash names');
assert.ok(!mainSource.includes('normalized === iniRemotePath(fileName)'), 'INI system paths should not validate every basename as a root INI filename');
assert.ok(mainSource.includes('assertIniWriteCheckPath'), 'INI write capability check should validate its exact temp path');
assert.ok(mainSource.includes('async function iniFsCheckWriteCapability'), 'main process should expose a restricted INI write capability check handler');
assert.ok(mainSource.includes('sftpWriteUtf8File(sftp, backupCheckPath'), 'INI write capability check should verify backup folder SFTP write');
assert.ok(mainSource.includes('sftpWriteUtf8File(sftp, remoteCheckPath'), 'INI write capability check should verify allowed INI root SFTP write');
assert.ok(mainSource.includes('sftpRename(sftp, remoteCheckPath, trashCheckPath)'), 'INI write capability check should verify restricted trash rename');
assert.ok(mainSource.includes('const remoteCheckPath = assertIniRootWritePath(`/media/fat/${checkFileName}`)'), 'INI write capability root temp file should use the root INI path validator');
assert.ok(mainSource.includes('const trashCheckPath = assertIniTrashWritePath(`${iniTrashRoot}/${iniTimestamp()}-${checkFileName}`)'), 'INI write capability trash temp file should use the trash path validator');
assert.ok(mainSource.includes('sftpUnlink(sftp, backupCheckPath)'), 'INI write capability check should clean up the guarded backup temp path');
assert.ok(mainSource.includes('sftpUnlink(sftp, trashCheckPath)'), 'INI write capability check should clean up the guarded trash temp path');
assert.ok(mainSource.includes('writeCapabilityTrash'), 'INI write capability failures should identify the trash move phase');
assert.ok(mainSource.includes("source: 'remote'"), 'remote INI entries should be marked as remote source');
assert.ok(mainSource.includes("'missing-remote'"), 'cache-only entries should be marked when remote file is missing');
assert.ok(mainSource.includes('rawMediaFatItemCount'), 'remote INI refresh should record raw /media/fat listing count');
assert.ok(mainSource.includes('remoteIniCandidateCount'), 'remote INI refresh should record filtered remote INI count');
assert.ok(mainSource.includes('iniEntryIsDirectory'), 'remote INI refresh should exclude directories without relying only on isFile metadata');
assert.ok(mainSource.includes('not-mister-ini'), 'remote INI refresh should track excluded non-MiSTer INI candidates');
assert.ok(mainSource.includes('message: remoteIniCandidateCount > 0'), 'remote INI refresh message should be based on actual remote candidates');
assert.ok(mainSource.includes('isSafeLocalIniDisplayFileName'), 'local import filenames should be validated without opening remote write scope');
assert.ok(mainSource.includes('localContent'), 'local import should return/store local content instead of silently writing remote INI');
assert.ok(mainSource.includes('INI_FS_MAIN_DELETE_BLOCKED'), 'MiSTer.ini delete should be blocked');
assert.ok(mainSource.includes('iniFsPreviewBackup'), 'main process should expose a backup preview reader');
assert.ok(mainSource.includes('assertIniBackupPath(fileName, request.backupPath)'), 'backup preview should validate the selected backup path');
assert.ok(mainSource.includes('INI_FS_BACKUP_PREVIEW_FAILED'), 'backup preview should return a specific safe error code');
assert.ok(mainSource.includes('async function iniFsDeleteBackup'), 'main process should expose a restricted INI backup delete handler');
assert.ok(mainSource.includes('async function iniFsDeleteTrashedIni'), 'main process should expose a restricted INI trash delete handler');
assert.ok(mainSource.includes('assertIniTrashPath(request.trashPath)'), 'trash restore/delete should validate the selected trash path');
assert.ok(mainSource.includes('await sftpRename(sftp, backupPath, trashPath)'), 'backup delete should soft-delete by moving the .bak into the INI trash with the active SFTP client');
assert.ok(mainSource.includes('sftpUnlink(sftp, trashPath)'), 'trash delete should use the active SFTP client');
assert.ok(mainSource.includes("if (!item.localContent && item.source === 'remote') continue;"), 'trashed remote-only metadata should not reappear as cache-only list items');
assert.ok(mainSource.includes('sftpMkdirRecursiveIni(sftp, backupDir)'), 'backup creation should use the active SFTP client');
assert.ok(mainSource.includes('sftpMkdirRecursiveIni(sftp, iniTrashRoot)'), 'trash creation should use the active SFTP client');
assert.ok(mainSource.includes('const backupPath = assertIniBackupWritePath(normalizedFile'), 'backup creation should validate backup paths with the backup path validator');
assert.ok(mainSource.includes('const trashPath = assertIniTrashWritePath(`${iniTrashRoot}/${iniTimestamp()}-${fileName}`)'), 'trash creation should validate timestamped trash paths with the trash path validator');
assert.ok(mainSource.includes('assertIniRootWritePath(targetPath)'), 'saving/restoring INI content should validate only root INI file targets with the root path validator');
assert.ok(mainSource.includes('async function iniFsCreateBackup'), 'INI backups are created on explicit user request (iniFsCreateBackup), not automatically on save');
assert.ok(mainSource.includes('await writeLocalIniBackup(profile.id, fileName, currentContent)'), 'INI save keeps a silent local PC-side copy of the previous content instead of an auto remote backup');
assert.ok(mainSource.includes('iniFsFailureResult'), 'INI write/trash failures should return phase-aware safe error results');
assert.ok(mainSource.includes("phase = 'writeLocalBackup'"), 'INI save should expose the silent local backup copy as a failure phase');
assert.ok(mainSource.includes("phase = 'writeRemote'"), 'INI save should expose remote write as a failure phase');
assert.ok(mainSource.includes("phase = 'rereadRemote'"), 'INI save should expose post-save verification as a failure phase');
assert.ok(mainSource.includes("phase = 'createTrashDir'"), 'INI trash should expose trash directory creation as a failure phase');
assert.ok(mainSource.includes("phase = 'moveToTrash'"), 'INI trash should expose SFTP rename as a failure phase');
assert.ok(pageSource.includes('INI 저장을 시작했습니다'), 'INI save should show progress immediately after confirmation');
assert.ok(pageSource.includes('MisterIniDesktopService.readRemoteIni(profileId, targetFileName)'), 'INI save success should reread the saved remote file');
assert.ok(pageSource.includes('저장된 원격 INI를 다시 읽었습니다'), 'INI save success should tell the user the remote file was reread');
assert.ok(pageSource.includes('INI 저장에 실패했습니다'), 'INI save exceptions should surface a Korean error message');
assert.ok(!mainSource.includes("ipcMain.handle('iniFs:writeRemote'"), 'generic INI remote write IPC should not exist');
assert.ok(!mainSource.includes("ipcMain.handle('remote:write'"), 'generic remote write IPC should not exist');
assert.ok(!mainSource.includes("ipcMain.handle('raw-command'"), 'raw command IPC should not exist');

console.log('Real MiSTer INI manager tests passed.');
