import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (filePath) => readFileSync(resolve(root, filePath), 'utf8');
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.tsx']);
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'release']);

function listTextFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = resolve(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      return ignoredDirectories.has(entry) ? [] : listTextFiles(fullPath);
    }
    const extension = entry.includes('.') ? entry.slice(entry.lastIndexOf('.')) : '';
    return textExtensions.has(extension) ? [fullPath] : [];
  });
}

async function importTranspiledTs(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: false,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');
const desktopTypes = read('src/types/desktop.ts');
const zaparooTypes = read('src/types/zaparoo.ts');
const zaparooClient = read('src/services/zaparoo/zaparooApiClient.ts');
const zaparooConfig = read('src/services/zaparoo/zaparooConfigDiagnostics.ts');
const misterFpgaPage = read('src/features/sticker-v1/pages/MisterFpgaPage.tsx');
const cardAlbumPage = read('src/features/sticker-v1/pages/CardAlbumPage.tsx');
const readme = read('docs/DEVLOG.md');

const forbiddenSettingName = `allow_${'launch'}`;
for (const filePath of listTextFiles(root)) {
  const text = readFileSync(filePath, 'utf8');
  assert.doesNotMatch(text, new RegExp(forbiddenSettingName), `${filePath} must not mention the obsolete Zaparoo setting name`);
}

for (const [label, text] of [
  ['electron/main.mjs', main],
  ['electron/preload.mjs', preload],
  ['src/types/zaparoo.ts', zaparooTypes],
  ['src/services/zaparoo/zaparooApiClient.ts', zaparooClient],
  ['src/services/zaparoo/zaparooConfigDiagnostics.ts', zaparooConfig],
  ['src/features/sticker-v1/pages/MisterFpgaPage.tsx', misterFpgaPage],
  ['src/features/sticker-v1/pages/CardAlbumPage.tsx', cardAlbumPage],
  ['docs/DEVLOG.md', readme],
]) {
  assert.doesNotMatch(text, new RegExp(forbiddenSettingName), `${label} must not mention the obsolete Zaparoo setting name`);
}

const {
  formatZaparooConfigDiagnostics,
  parseZaparooConfigToml,
  zaparooRunFailureMessage,
} = await importTranspiledTs('src/services/zaparoo/zaparooConfigDiagnostics.ts');

const missingAllowRun = parseZaparooConfigToml('[service]\nallowed_ips = []\n');
assert.equal(missingAllowRun.serviceFound, true, 'service section should be detected');
assert.equal(missingAllowRun.allowRun.present, false, 'missing allow_run should be detected');
assert.equal(missingAllowRun.allowRun.empty, true, 'missing allow_run should be treated as empty');
assert.equal(missingAllowRun.allowedIps.present, true, 'allowed_ips should be detected independently');

const emptyAllowRun = parseZaparooConfigToml('[service]\nallow_run = []\n');
assert.equal(emptyAllowRun.allowRun.present, true, 'empty allow_run should be present');
assert.equal(emptyAllowRun.allowRun.empty, true, 'empty allow_run should be empty');

const allowRunPatterns = parseZaparooConfigToml(`
[service]
allow_run = [
  "^/media/fat/games/NES/.*",
  "^/media/fat/games/SNES/.*", # comment
]
allowed_ips = ["192.168.0.0/16", "10.0.0.5"]
`);
assert.equal(allowRunPatterns.allowRun.count, 2, 'allow_run pattern count should be parsed');
assert.equal(allowRunPatterns.allowedIps.count, 2, 'allowed_ips restricted array should be parsed');
assert.equal(allowRunPatterns.allowedIpsLimited, true, 'restricted allowed_ips should be marked limited');

const missingAllowedIps = parseZaparooConfigToml('[service]\nallow_run = ["^.*$"]\n');
assert.equal(missingAllowedIps.allowedIps.present, false, 'missing allowed_ips should be detected');

const emptyAllowedIps = parseZaparooConfigToml('[service]\nallow_run = ["^.*$"]\nallowed_ips = []\n');
assert.equal(emptyAllowedIps.allowedIps.present, true, 'empty allowed_ips should be present');
assert.equal(emptyAllowedIps.allowedIps.empty, true, 'empty allowed_ips should be empty');
assert.equal(emptyAllowedIps.allowedIpMatch, 'unrestricted', 'empty allowed_ips should be treated as unrestricted');

const parseFailed = parseZaparooConfigToml('[service]\nallow_run = "^.*$"\n');
assert.equal(parseFailed.status, 'parse-failed', 'malformed allow_run should mark parse-failed');
assert.match(formatZaparooConfigDiagnostics(parseFailed), /해석에 실패/, 'basic formatter should hide raw parse detail');
assert.match(formatZaparooConfigDiagnostics(parseFailed, true), /allow_run 배열을 해석하지 못했습니다/, 'developer formatter should include sanitized parse detail');

assert.match(zaparooRunFailureMessage('API_OFFLINE'), /Zaparoo API에 연결할 수 없습니다/, 'API_OFFLINE formatter should guide Core startup check');
assert.match(zaparooRunFailureMessage('RUN_METHOD_FAILED'), /run 실행 요청이 실패/, 'RUN_METHOD_FAILED formatter should be specific');
assert.match(zaparooRunFailureMessage('RUN_ENDPOINT_FAILED'), /\/run\/ fallback 호출이 실패/, 'RUN_ENDPOINT_FAILED formatter should name fallback');
assert.match(zaparooRunFailureMessage('ALLOW_RUN_MISSING'), /allow_run이 비어 있거나 없습니다/, 'ALLOW_RUN_MISSING formatter should name empty or missing allow_run');
assert.match(zaparooRunFailureMessage('ALLOW_RUN_BLOCKED'), /allow_run 규칙과 맞지 않을 수 있습니다/, 'ALLOW_RUN_BLOCKED formatter should explain pattern mismatch');
assert.match(zaparooRunFailureMessage('ALLOWED_IPS_BLOCKED'), /allowed_ips 설정/, 'ALLOWED_IPS_BLOCKED formatter should name allowed_ips');

assert.match(main, /zaparooConfig: '\/media\/fat\/zaparoo\/config\.toml'/, 'Electron main should know the Zaparoo config path');
assert.match(main, /sftpReadFile\(sftp, remotePaths\.zaparooConfig/, 'Zaparoo config diagnostics should read config through SFTP only');
assert.match(main, /ipcMain\.handle\('zaparoo:config:diagnose'/, 'Electron main should expose fixed config diagnostic IPC');
assert.match(preload, /zaparooReadConfigDiagnostics/, 'preload should expose fixed Zaparoo config diagnostic API');
assert.match(desktopTypes, /zaparooReadConfigDiagnostics/, 'desktop types should include config diagnostic API');

assert.match(zaparooTypes, /API_ENDPOINT_FAILED/, 'run failure codes should include API endpoint failures');
assert.match(zaparooTypes, /ALLOW_RUN_MISSING/, 'run failure codes should include missing allow_run');
assert.match(zaparooTypes, /ALLOW_RUN_BLOCKED/, 'run failure codes should include blocked allow_run');
assert.match(zaparooTypes, /ALLOWED_IPS_BLOCKED/, 'run failure codes should include allowed_ips blocking');
assert.match(zaparooConfig, /parseZaparooConfigToml/, 'config parser should be implemented without a new dependency');
assert.match(zaparooConfig, /formatZaparooConfigDiagnostics/, 'config diagnostics formatter should exist');
assert.match(zaparooConfig, /allow_run/, 'config parser should inspect allow_run');
assert.match(zaparooConfig, /allowed_ips/, 'config parser should inspect allowed_ips');
assert.match(zaparooClient, /readConfigDiagnostics/, 'renderer client should call read-only config diagnostics');
assert.match(main, /classifyZaparooRunFailure\(\{ methodResult, fallbackResult, configDiagnostics \}\)/, 'run failure classification should consider method, fallback, and config diagnostics');
assert.match(main, /API_ENDPOINT_FAILED/, 'Electron main should classify API endpoint failures');
assert.match(main, /ALLOWED_IPS_BLOCKED/, 'Electron main should classify allowed_ips blocking');

assert.doesNotMatch(misterFpgaPage, /sections[\s\S]*\{ id: 'connection'/, 'MiSTer game list visible sections should not include a duplicate connection tab');
assert.match(misterFpgaPage, /function sectionFromPath\(pathname: string\): Section \{[\s\S]*?return 'browser';\s*\}/, 'connection section should be hidden from the MiSTer game list tabs via routing logic');
assert.doesNotMatch(misterFpgaPage.slice(misterFpgaPage.indexOf('function sectionFromPath'), misterFpgaPage.indexOf('function sectionFromPath') + 300), /return 'connection'/, 'MiSTer game list routing should never resolve to the connection section');
assert.match(misterFpgaPage, /MiSTer 연결 메뉴에서 연결하세요|MiSTer.*connection/i, 'game list should guide disconnected users to the main MiSTer connection flow');
assert.match(misterFpgaPage, /Zaparoo 진단/, 'game list should expose Zaparoo diagnostics');
assert.match(misterFpgaPage, /formatZaparooConfigDiagnostics/, 'game list diagnostics should use the config diagnostics formatter');
assert.match(cardAlbumPage, /Zaparoo 실행 진단/, 'card album launch failure UI should show diagnostics');
assert.match(cardAlbumPage, /config\.toml을 자동 수정하지 않습니다/, 'card album should state config.toml is not modified');

assert.doesNotMatch(main, /ipcMain\.handle\('zaparoo:rpc'/, 'arbitrary Zaparoo RPC IPC must remain absent');
assert.doesNotMatch(main, /ipcMain\.handle\('zaparoo:config:(write|save|update)'/, 'Zaparoo config write IPC must remain absent');
assert.doesNotMatch(preload, /raw.*command|command:raw/i, 'raw command IPC must remain absent');
assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)'/, 'ROM write IPC must remain absent');
assert.doesNotMatch(preload, /rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)/, 'preload must not expose ROM write IPC');

console.log('phase nineteen Zaparoo allow_run diagnostics tests passed.');
