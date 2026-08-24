import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const require = createRequire(import.meta.url);

function loadTsModule(path) {
  const source = read(path);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { module: { exports: {} }, exports: {}, require };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(output, sandbox, { filename: path });
  return sandbox.module.exports;
}

const tokenEvents = loadTsModule('src/services/zaparoo/zaparooNfcTokenEvents.ts');
const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');
const desktopTypes = read('src/types/desktop.ts');
const zaparooTypes = read('src/types/zaparoo.ts');
const zaparooClient = read('src/services/zaparoo/zaparooApiClient.ts');
const misterPage = read('src/features/sticker-v1/pages/MisterFpgaPage.tsx');

const parsed = tokenEvents.parseZaparooSseEventBlock([
  'event: tokens.added',
  'data: {"text":"**launch:/media/fat/games/NES/Mario.nes"}',
  '',
].join('\n'));
assert.equal(parsed.event, 'tokens.added', 'SSE parser should parse event name');
assert.equal(tokenEvents.isZaparooTokensAddedEvent(parsed), true, 'tokens.added event should be detected');
assert.equal(tokenEvents.extractZaparooTokenText(parsed.data), '**launch:/media/fat/games/NES/Mario.nes', 'tokens.added text should be extracted');

const nestedParsed = tokenEvents.parseZaparooSseEventBlock('data: {"method":"tokens.added","params":{"token":{"payload":"abc"}}}\n\n');
assert.equal(tokenEvents.isZaparooTokensAddedEvent(nestedParsed), true, 'JSON-RPC notification style tokens.added should be detected');
assert.equal(tokenEvents.extractZaparooTokenText(nestedParsed.data), 'abc', 'nested token payload should be extracted');

assert.equal(tokenEvents.extractZaparooTokenText({ method: 'tokens.added', params: { token: {} } }), undefined, 'missing token text should return undefined');
assert.match(tokenEvents.formatZaparooNfcReadStatus('timeout', 'NFC_READ_TIMEOUT'), /태그를 감지하지 못했습니다/, 'timeout formatter should guide re-scan');
assert.match(tokenEvents.formatZaparooNfcReadStatus('verified'), /일치합니다/, 'verified formatter should mention matching payload');
assert.match(tokenEvents.formatZaparooNfcReadStatus('mismatch', 'NFC_VERIFY_MISMATCH'), /다른 데이터/, 'mismatch formatter should mention different data');

assert.equal(tokenEvents.getZaparooNfcReadReadiness({ hasActiveMister: true, zaparooApiConnected: true, readerCount: 1 }).canRead, true, 'read readiness should be true with active MiSTer, API, and reader');
assert.equal(tokenEvents.getZaparooNfcReadReadiness({ hasActiveMister: true, zaparooApiConnected: true, readerCount: 1, payloadValid: false }).canRead, true, 'invalid payload must not block tag reading');
assert.equal(tokenEvents.getZaparooNfcReadReadiness({ hasActiveMister: false, zaparooApiConnected: true, readerCount: 1 }).code, 'ACTIVE_MISTER_REQUIRED', 'missing active MiSTer should block read');
assert.equal(tokenEvents.getZaparooNfcReadReadiness({ hasActiveMister: true, zaparooApiConnected: false, readerCount: 1 }).code, 'ZAPAROO_API_DISCONNECTED', 'disconnected Zaparoo API should block read');
assert.equal(tokenEvents.getZaparooNfcReadReadiness({ hasActiveMister: true, zaparooApiConnected: true, readerCount: 0 }).code, 'NFC_READER_MISSING', 'missing reader should block read');

assert.equal(tokenEvents.compareZaparooNfcTokenText(' abc \r\n', 'abc').status, 'verified', 'comparison should normalize whitespace');
assert.equal(tokenEvents.compareZaparooNfcTokenText('abc', 'def').status, 'mismatch', 'different token text should mismatch');
assert.equal(tokenEvents.compareZaparooNfcTokenText('abc', '').status, 'tagDetected', 'reading without expected payload should still succeed as tag detected');

assert.match(zaparooTypes, /ZaparooTokenReadResult/, 'types should define token read result');
assert.match(zaparooClient, /readTokenOnce/, 'renderer client should expose token event read');
assert.match(zaparooClient, /cancelTokenRead/, 'renderer client should expose token event cancellation');
assert.match(desktopTypes, /zaparooReadTokenOnce/, 'desktop API should include token read IPC');
assert.match(desktopTypes, /zaparooCancelTokenRead/, 'desktop API should include token cancel IPC');
assert.match(preload, /zaparoo:token-read-once/, 'preload should expose fixed token read IPC');
assert.match(preload, /zaparoo:token-read-cancel/, 'preload should expose fixed token read cancel IPC');
assert.match(main, /zaparoo:token-read-once/, 'main should register fixed token read IPC');
assert.match(main, /text\/event-stream/, 'main should subscribe to Zaparoo SSE events');
assert.match(main, /tokens\.added/, 'main should wait for tokens.added events');
assert.match(main, /tokens\.history/, 'main should include fixed token history fallback');
assert.match(main, /zaparooTokenReadControllers/, 'main should keep cancellable read controllers for cleanup');

assert.match(misterPage, /getZaparooNfcReadReadiness/, 'NFC screen should use read readiness rules');
assert.match(misterPage, /readTokenOnce/, 'NFC screen should read through Zaparoo token events');
assert.match(misterPage, /cancelTokenRead/, 'NFC screen should support read cancellation');
assert.doesNotMatch(misterPage, /bridgeTagAdapter\(\)\.read/, 'NFC screen should not call the old bridge read path');
assert.match(misterPage, /쓰기 완료\. 검증하려면 태그를 리더에서 떼었다가 다시 올린 뒤 태그 읽기를 누르세요\./, 'write completion should guide remove-and-rescan verification');
assert.doesNotMatch(misterPage, new RegExp(['쓰기 ', '요청이 ', '완료되었습니다'].join('')), 'write completion should not be phrased as request completion');
assert.match(misterPage, /NFC 쓰기 완료/, 'NFC screen should show a strong write completion panel');
assert.match(misterPage, /태그에 실행 데이터가 기록되었습니다/, 'NFC write completion panel should clearly say the tag was written');
assert.match(misterPage, /tagStatus !== 'written'/, 'small tag message should not duplicate the strong written-state panel');

assert.doesNotMatch(main, /ipcMain\.handle\('zaparoo:rpc'/, 'arbitrary Zaparoo RPC IPC must remain absent');
assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)'/, 'ROM write IPC must remain absent');
assert.doesNotMatch(preload, /rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)/, 'preload must not expose ROM write IPC');
assert.doesNotMatch(preload, /raw.*command|command:raw/i, 'raw command IPC must remain absent');
assert.doesNotMatch(main, /password.*writeJsonFile|privateKey.*writeJsonFile|passphrase.*writeJsonFile|token.*writeJsonFile/i, 'secrets must not be written to appData JSON in plaintext');

console.log('phase twenty-two NFC token event tests passed.');
