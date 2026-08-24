import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { RomTransferProvider } from './contexts/RomTransferContext';
import { StickerStudioPage } from './pages/StickerStudioPage';
import { MisterConnectionPage } from './pages/MisterConnectionPage';
import { SdCardManagementPage } from './pages/SdCardManagementPage';
import { GameManagementPage } from './pages/GameManagementPage';
import { ScriptManagementPage } from './pages/ScriptManagementPage';
import { IniSettingsRealPage } from './pages/IniSettingsRealPage';
import { ControllerSetupPage } from './pages/ControllerSetupPage';
import { BackupDiagnosticsPage } from './pages/BackupDiagnosticsPage';
import { SettingsPage } from './pages/SettingsPage';
import './features/sticker-v1/styles/globals.css';
import './styles.css';

const rootElement = document.getElementById('root');

function renderFatalError(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
  if (!rootElement) return;
  rootElement.innerHTML = `
    <main style="font-family: system-ui, sans-serif; padding: 32px; color: #1f2937;">
      <h1 style="font-size: 24px;">화면을 불러오지 못했습니다.</h1>
      <p>Hello Mister v2.1 렌더러 초기화 중 문제가 발생했습니다.</p>
      <pre style="white-space: pre-wrap; background: #f3f4f6; padding: 16px; border-radius: 8px;">${message}</pre>
    </main>
  `;
}

try {
  if (!rootElement) throw new Error('React root element를 찾을 수 없습니다.');
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <HashRouter>
        <RomTransferProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/stickers/mister" replace />} />
            <Route path="/stickers/*" element={<StickerStudioPage />} />
            <Route path="/mister" element={<MisterConnectionPage />} />
            <Route path="/connection" element={<Navigate to="/mister" replace />} />
            <Route path="/sd-card" element={<SdCardManagementPage />} />
            <Route path="/games" element={<GameManagementPage />} />
            <Route path="/scripts" element={<ScriptManagementPage />} />
            <Route path="/ini" element={<IniSettingsRealPage />} />
            <Route path="/controllers" element={<Navigate to="/controller-setup" replace />} />
            <Route path="/controller-setup" element={<ControllerSetupPage />} />
            <Route path="/backup" element={<BackupDiagnosticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/stickers/mister" replace />} />
          </Route>
        </Routes>
        </RomTransferProvider>
      </HashRouter>
    </React.StrictMode>,
  );
} catch (error) {
  console.error('[Hello Mister] renderer bootstrap failed', error);
  renderFatalError(error);
}
