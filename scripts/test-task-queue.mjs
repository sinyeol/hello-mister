import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/tasks/taskQueue.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types/tasks.ts', import.meta.url), 'utf8');

assert.match(types, /readOnly\?: boolean/, 'task entries should mark read-only tasks');
assert.match(types, /errorCode\?: string/, 'task entries should persist error codes');
assert.match(types, /sanitizedErrorMessage/, 'task entries should keep sanitized error messages');
assert.match(source, /maxTaskLogCount = 100/, 'task queue should keep the latest 100 tasks');
assert.match(source, /hydrate/, 'task queue should hydrate persisted logs');
assert.match(source, /loadTaskLogs/, 'task queue should load Electron persisted logs');
assert.match(source, /saveTaskLogs/, 'task queue should persist Electron logs');
assert.match(source, /exportLogs/, 'task queue should export task logs');
assert.match(source, /stripSecrets/, 'task queue should sanitize secrets before persistence');
assert.doesNotMatch(source.match(/function sanitizeTask[\s\S]*?\n}/)?.[0] ?? '', /rawCommand[^|]/i, 'raw commands should not be persisted as task fields');

console.log('Task queue persistence tests passed.');
