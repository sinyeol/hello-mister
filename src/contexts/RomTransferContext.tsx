import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RomFsOperationResult } from '../types/rom';

// A single batch of file-copy operations, tracked at app level so it survives menu navigation. The actual transfer
// runs in the Electron main process; this context only drives the queue loop + progress UI from the renderer, so
// leaving the ROM page no longer hides (or interrupts) an in-flight copy.
export type RomTransferStatus = 'running' | 'cancelling' | 'done' | 'cancelled';

export interface RomTransferJob {
  id: number;
  title: string;
  total: number;
  completed: number;
  failed: number;
  status: RomTransferStatus;
  results: RomFsOperationResult[];
}

export interface RomTransferBatchOutcome {
  results: RomFsOperationResult[];
  cancelled: boolean;
}

export type RomTransferOp = () => Promise<RomFsOperationResult>;

interface RomTransferContextValue {
  job: RomTransferJob | null;
  isRunning: boolean;
  runOperations: (ops: RomTransferOp[], title: string) => Promise<RomTransferBatchOutcome>;
  cancel: () => void;
  dismiss: () => void;
}

const RomTransferContext = createContext<RomTransferContextValue | null>(null);

const isFailedResult = (result: RomFsOperationResult) => !result.ok || result.status === 'failed';

export function RomTransferProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<RomTransferJob | null>(null);
  const cancelRef = useRef(false);
  const runningRef = useRef(false);
  const idRef = useRef(0);
  // Serializes batches: a second copy started while one runs waits its turn instead of interleaving. Each caller still
  // gets its own results back (important for the cut-paste "trash source only after a clean copy" contract).
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  const runBatchInternal = useCallback(async (ops: RomTransferOp[], title: string): Promise<RomTransferBatchOutcome> => {
    if (ops.length === 0) return { results: [], cancelled: false };
    runningRef.current = true;
    cancelRef.current = false;
    const id = (idRef.current += 1);
    setJob({ id, title, total: ops.length, completed: 0, failed: 0, status: 'running', results: [] });
    const results: RomFsOperationResult[] = [];
    for (let index = 0; index < ops.length; index += 1) {
      if (cancelRef.current) break;
      const result = await ops[index]();
      results.push(result);
      const failed = results.filter(isFailedResult).length;
      // Keep only the tail of results in state to bound memory on huge batches; callers get the full array returned.
      setJob((current) => (current && current.id === id
        ? { ...current, completed: index + 1, failed, results: results.slice(-50) }
        : current));
    }
    const cancelled = cancelRef.current;
    runningRef.current = false;
    setJob((current) => (current && current.id === id
      ? { ...current, status: cancelled ? 'cancelled' : 'done' }
      : current));
    return { results, cancelled };
  }, []);

  const runOperations = useCallback((ops: RomTransferOp[], title: string) => {
    const outcome = chainRef.current.then(() => runBatchInternal(ops, title));
    chainRef.current = outcome.catch(() => undefined);
    return outcome;
  }, [runBatchInternal]);

  // Cancel stops the loop after the current operation finishes (never mid-file), so no partial/corrupt transfer.
  const cancel = useCallback(() => {
    if (!runningRef.current) return;
    cancelRef.current = true;
    setJob((current) => (current && current.status === 'running' ? { ...current, status: 'cancelling' } : current));
  }, []);

  const dismiss = useCallback(() => {
    setJob((current) => (current && (current.status === 'done' || current.status === 'cancelled') ? null : current));
  }, []);

  const isRunning = !!job && (job.status === 'running' || job.status === 'cancelling');

  const value = useMemo<RomTransferContextValue>(
    () => ({ job, isRunning, runOperations, cancel, dismiss }),
    [job, isRunning, runOperations, cancel, dismiss],
  );

  return <RomTransferContext.Provider value={value}>{children}</RomTransferContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider (no runtime cost)
export function useRomTransfer(): RomTransferContextValue {
  const context = useContext(RomTransferContext);
  if (!context) throw new Error('useRomTransfer must be used within RomTransferProvider');
  return context;
}
