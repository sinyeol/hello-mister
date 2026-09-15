// Shared helper for the sticker-v1 behavioural tests (ported from the original v1 zaparoo-nfc-card-stickers repo).
// A TypeScript module is transpiled on the fly and imported as a data: URL, so pure logic modules can be exercised
// without a bundler. `@sticker-v1/*` aliases and relative imports are resolved recursively; type-only imports vanish
// during transpilation, so the leaf modules under test stay dependency-free.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { builtinModules } from 'node:module';
import ts from 'typescript';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stickerRoot = path.join(repoRoot, 'src', 'features', 'sticker-v1');
const moduleUrlCache = new Map();
const loading = new Set();

export function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function resolveImport(specifier, fromFile) {
  let base;
  if (specifier.startsWith('@sticker-v1/')) base = path.join(stickerRoot, specifier.slice('@sticker-v1/'.length));
  else if (specifier.startsWith('./') || specifier.startsWith('../')) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (!found) throw new Error(`Cannot resolve import '${specifier}' from ${fromFile}`);
  return found;
}

function isNodeBuiltin(specifier) {
  const name = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  return builtinModules.includes(name);
}

function moduleUrlForFile(file) {
  const cached = moduleUrlCache.get(file);
  if (cached) return cached;
  if (loading.has(file)) throw new Error(`Circular import while loading ${file}`);
  loading.add(file);
  const rawSource = readFileSync(file, 'utf8');
  const source = rawSource.charCodeAt(0) === 0xfeff ? rawSource.slice(1) : rawSource;
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  const rewritten = outputText.replace(/(\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2/g, (match, prefix, quote, specifier) => {
    const resolved = resolveImport(specifier, file);
    if (!resolved) {
      if (isNodeBuiltin(specifier)) return match;
      throw new Error(`'${specifier}' (imported by ${file}) is a package import; data: URL modules can only load node built-ins`);
    }
    return `${prefix}${quote}${moduleUrlForFile(resolved)}${quote}`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`;
  loading.delete(file);
  moduleUrlCache.set(file, url);
  return url;
}

export function importTs(relativePath) {
  return import(moduleUrlForFile(path.resolve(repoRoot, relativePath)));
}

export class MemoryStorage {
  #values = new Map();

  get length() {
    return this.#values.size;
  }

  key(index) {
    return Array.from(this.#values.keys())[index] ?? null;
  }

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }

  clear() {
    this.#values.clear();
  }
}

export function installBrowserGlobals() {
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  globalThis.window = { localStorage: storage };
  return storage;
}
