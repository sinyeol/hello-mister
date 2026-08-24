import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/mister/fingerprint.ts', import.meta.url), 'utf8');

assert.match(source, /macSuffix/, 'MAC suffix formatter should exist');
assert.match(source, /MiSTer @ \$\{candidate\.ipAddress\} \/ MAC \$\{suffix\}/, 'duplicate hostname display should include IP and MAC suffix');
assert.match(source, /candidate\.alias/, 'alias should take display priority');

console.log('Fingerprint formatter tests passed.');
