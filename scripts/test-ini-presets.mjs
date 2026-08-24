import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/data/iniPresets.ts', import.meta.url), 'utf8');

for (const name of ['HDMI 기본', 'HDMI 저지연', 'CRT 15kHz', '캡처카드', '세로 아케이드']) {
  assert.ok(source.includes(`name: '${name}'`), `${name} preset should exist`);
}

assert.match(source, /riskLevel: '위험'/, 'danger preset should be explicitly marked');
assert.match(source, /TODO: 공식 MiSTer\.ini 템플릿 확인 후 값 확정/, 'presets should not hardcode risky final values yet');

console.log('INI preset skeleton tests passed.');
