import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

export type PressAndHoldModifiers = {
  shiftKey: boolean;
  altKey: boolean;
};

export function usePressAndHold<T extends HTMLElement>(
  action: (modifiers: PressAndHoldModifiers) => void,
  options: { initialDelayMs?: number; repeatIntervalMs?: number } = {},
) {
  const actionRef = useRef(action);
  const timeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const initialDelayMs = options.initialDelayMs ?? 250;
  const repeatIntervalMs = options.repeatIntervalMs ?? 75;

  useEffect(() => {
    actionRef.current = action;
  }, [action]);

  const stop = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback((event: ReactPointerEvent<T>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stop();

    const modifiers = {
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    };

    actionRef.current(modifiers);
    timeoutRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(() => {
        actionRef.current(modifiers);
      }, repeatIntervalMs);
    }, initialDelayMs);
  }, [initialDelayMs, repeatIntervalMs, stop]);

  const triggerFromKeyboard = useCallback((event: ReactKeyboardEvent<T>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    actionRef.current({
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });
  }, []);

  useEffect(() => {
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      stop();
    };
  }, [stop]);

  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onKeyDown: triggerFromKeyboard,
  };
}
