import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as wait } from 'node:timers/promises';

const root = process.cwd();
const debugPort = Number(process.env.HELLO_MISTER_CDP_PORT || 9231);
const smokeUserDataDir = path.join(root, '.tmp', 'electron-smoke-user-data');
const electronBin = process.platform === 'win32'
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'node_modules', '.bin', 'electron');

async function fetchJsonWithRetry(url, retries = 30) {
  let lastError;
  for (let index = 0; index < retries; index += 1) {
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  throw lastError || new Error(`Could not fetch ${url}`);
}

function createCdpClient(webSocketDebuggerUrl) {
  const socket = new globalThis.WebSocket(webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (!data.id || !pending.has(data.id)) return;
    pending.get(data.id)(data);
    pending.delete(data.id);
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP WebSocket connection timed out')), 8000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({
        send(method, params = {}) {
          const message = { id: ++id, method, params };
          return new Promise((done) => {
            pending.set(message.id, done);
            socket.send(JSON.stringify(message));
          });
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener('error', reject);
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.result?.value || result.result?.result?.value;
}

function assertRendered(value, context) {
  if (!value || value.rootChildren < 1 || /화면을 불러오지 못했습니다|React UI did not render/.test(value.bodyText || '')) {
    throw new Error(`${context} did not render: ${JSON.stringify(value)}`);
  }
}

async function main() {
  await fs.rm(smokeUserDataDir, { recursive: true, force: true });
  await fs.mkdir(smokeUserDataDir, { recursive: true });

  const child = spawn(electronBin, [`--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*', `--user-data-dir=${smokeUserDataDir}`, '.'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  try {
    const pages = await fetchJsonWithRetry(`http://127.0.0.1:${debugPort}/json`);
    const page = pages.find((entry) => entry.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('Electron page target was not found');
    const cdp = await createCdpClient(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    let value;
    for (let index = 0; index < 20; index += 1) {
      value = await evaluate(cdp, `({
        title: document.title,
        rootChildren: document.querySelector('#root')?.children.length || 0,
        bodyText: document.body.innerText.slice(0, 300),
        scripts: [...document.scripts].map((script) => script.src),
        links: [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.href)
      })`);
      if (value?.rootChildren > 0) break;
      await wait(500);
    }
    assertRendered(value, 'React UI');
    if (!/Hello Mister/i.test(value.bodyText)) throw new Error(`Hello Mister shell text missing: ${JSON.stringify(value)}`);
    const missingAbsoluteAsset = [...value.scripts, ...value.links].some((assetUrl) => /file:\/\/\/assets\//i.test(assetUrl));
    if (missingAbsoluteAsset) throw new Error(`Asset path is still absolute: ${JSON.stringify(value)}`);

    const controllerIpcValue = await evaluate(cdp, `window.helloMisterDesktop.controllerFsScanInventory({ profileId: '__smoke_missing_profile__' })
      .then((result) => ({ invoked: true, result }))
      .catch((error) => ({ invoked: false, message: String(error?.message || error) }))`);
    if (!controllerIpcValue?.invoked || /No handler registered/i.test(controllerIpcValue.message || JSON.stringify(controllerIpcValue))) {
      throw new Error(`Controller scan IPC handler is missing: ${JSON.stringify(controllerIpcValue)}`);
    }
    if (!Array.isArray(controllerIpcValue.result?.candidateRoots) || controllerIpcValue.result.candidateRoots.length === 0) {
      throw new Error(`Controller scan IPC did not return candidate roots: ${JSON.stringify(controllerIpcValue)}`);
    }

    const stickerRoutes = [
      '#/stickers',
      '#/stickers/mister',
      '#/stickers/images',
      '#/stickers/templates',
      '#/stickers/editor',
      '#/stickers/album',
      '#/stickers/output',
      '#/stickers/template-editor',
      '#/stickers/nfc',
    ];
    for (const route of stickerRoutes) {
      await cdp.send('Runtime.evaluate', { expression: `location.hash = ${JSON.stringify(route)}; true`, returnByValue: true });
      await wait(300);
      const routeValue = await evaluate(cdp, `({
        hash: location.hash,
        rootChildren: document.querySelector('#root')?.children.length || 0,
        bodyText: document.body.innerText.slice(0, 500),
        hasV2Sidebar: Boolean(document.querySelector('.sidebar') && [...document.querySelectorAll('.nav-toggle')].some((button) => button.textContent.includes('MiSTer FPGA'))),
        hasStickerSubmenu: Boolean(document.querySelector('a[href="#/stickers/mister"]') && document.querySelector('a[href="#/stickers/template-editor"]'))
      })`);
      assertRendered(routeValue, `Sticker route ${route}`);
      const expectedRoute = route === '#/stickers' ? '#/stickers/mister' : route;
      if (routeValue.hash !== expectedRoute) throw new Error(`Sticker route hash mismatch: ${route} ${JSON.stringify(routeValue)}`);
      if (!routeValue.hasV2Sidebar) throw new Error(`v2 sidebar disappeared on sticker route: ${route}`);
      if (!routeValue.hasStickerSubmenu) throw new Error(`sticker submenu missing on route: ${route}`);
    }

    const stickerMenuChecks = [
      { selector: 'a[href="#/stickers/mister"]', route: '#/stickers/mister' },
      { selector: 'a[href="#/stickers/templates"]', route: '#/stickers/templates' },
      { selector: 'a[href="#/stickers/editor"]', route: '#/stickers/editor' },
      { selector: 'a[href="#/stickers/images"]', route: '#/stickers/images' },
      { selector: 'a[href="#/stickers/album"]', route: '#/stickers/album' },
      { selector: 'a[href="#/stickers/output"]', route: '#/stickers/output' },
      { selector: 'a[href="#/stickers/template-editor"]', route: '#/stickers/template-editor' },
      { selector: 'a[href="#/stickers/nfc"]', route: '#/stickers/nfc' },
    ];
    for (const check of stickerMenuChecks) {
      await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/stickers/mister'; true`, returnByValue: true });
      await wait(350);
      const clicked = await evaluate(cdp, `(() => {
        const target = document.querySelector(${JSON.stringify(check.selector)});
        if (!target) return false;
        target.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`Sticker submenu item was not clickable: ${check.selector}`);
      await wait(600);
      const clickValue = await evaluate(cdp, `({
        hash: location.hash,
        rootChildren: document.querySelector('#root')?.children.length || 0,
        bodyText: document.body.innerText.slice(0, 800),
        hasV2Sidebar: Boolean(document.querySelector('.sidebar') && [...document.querySelectorAll('.nav-toggle')].some((button) => button.textContent.includes('MiSTer FPGA')))
      })`);
      assertRendered(clickValue, `Sticker submenu ${check.selector}`);
      if (clickValue.hash !== check.route || !clickValue.hasV2Sidebar) {
        throw new Error(`Sticker submenu click failed: ${check.selector} ${JSON.stringify(clickValue)}`);
      }
    }

    cdp.close();
    console.log(JSON.stringify(value, null, 2));
  } finally {
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
    await wait(500);
    if (!child.killed) child.kill('SIGKILL');
  }

  if (stderr.join('').includes('ERR_FILE_NOT_FOUND')) {
    throw new Error(`Electron stderr contains ERR_FILE_NOT_FOUND: ${stderr.join('')}`);
  }
}

await main();
