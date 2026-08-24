import { useEffect, useState } from 'react';

export type AppMode = 'basic' | 'advanced';
export type AppViewMode = AppMode;

const VIEW_MODE_STORAGE_KEY = 'hello-mister-v2-view-mode';
const VIEW_MODE_EVENT = 'hello-mister-view-mode-change';

export function normalizeViewMode(value: unknown): AppMode {
  if (value === 'developer') return 'advanced';
  if (value === 'advanced') return 'advanced';
  if (value === 'simple') return 'basic';
  if (value === 'basic') return 'basic';
  return 'basic';
}

export function getStoredViewMode(): AppMode {
  if (typeof window === 'undefined') return 'basic';
  return normalizeViewMode(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY));
}

export function setStoredViewMode(mode: AppMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent<AppMode>(VIEW_MODE_EVENT, { detail: mode }));
}

export function formatViewMode(mode: AppMode) {
  if (mode === 'advanced') return '고급';
  return '기본';
}

export function isAdvancedMode(mode: AppMode) {
  return mode === 'advanced';
}

export function modeRank(mode: AppMode) {
  if (mode === 'advanced') return 2;
  return 1;
}

export function modeMeets(mode: AppMode, minimum: AppMode) {
  return modeRank(mode) >= modeRank(minimum);
}

export function useAppViewMode() {
  const [viewMode, setViewModeState] = useState<AppMode>(() => getStoredViewMode());

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === VIEW_MODE_STORAGE_KEY) {
        setViewModeState(normalizeViewMode(event.newValue));
      }
    }

    function handleViewModeChange(event: Event) {
      setViewModeState(normalizeViewMode((event as CustomEvent<AppMode>).detail));
    }

    window.addEventListener('storage', handleStorage);
    window.addEventListener(VIEW_MODE_EVENT, handleViewModeChange);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(VIEW_MODE_EVENT, handleViewModeChange);
    };
  }, []);

  function setViewMode(mode: AppMode) {
    setViewModeState(mode);
    setStoredViewMode(mode);
  }

  return [viewMode, setViewMode] as const;
}
