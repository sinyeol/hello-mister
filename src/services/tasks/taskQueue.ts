import type { SafeTask, TaskStatus } from '../../types/tasks';

const maxTaskLogCount = 100;
const browserTaskLogKey = 'hello-mister-v2-task-log';
const secretKeyPattern = /password|privateKey|passphrase|token|secret|credential|rawCommand/i;
const terminalStatusPattern = /완료|실패|차단|done|failed|blocked|cancelled|취소/i;
const failedStatusPattern = /실패|차단|failed|blocked/i;

function stripSecrets<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, innerValue) => (
    secretKeyPattern.test(key) ? '[removed]' : innerValue
  )));
}

export function sanitizeTask(task: SafeTask): SafeTask {
  const now = new Date().toISOString();
  const safe = stripSecrets(task);
  const createdAt = safe.createdAt || now;
  const finishedAt = safe.finishedAt || safe.completedAt;
  return {
    ...safe,
    id: String(safe.id || createTaskId('task')),
    title: String(safe.title || '작업'),
    description: String(safe.description || ''),
    riskLevel: safe.riskLevel || '안전',
    dryRun: Boolean(safe.dryRun),
    readOnly: safe.readOnly !== false,
    status: safe.status || '대기',
    logs: Array.isArray(safe.logs) ? safe.logs.map((log) => ({
      at: log.at || now,
      message: String(log.message || '').replace(/password|privateKey|passphrase|token/ig, '[secret]'),
    })) : [],
    createdAt,
    startedAt: safe.startedAt || createdAt,
    completedAt: safe.completedAt,
    finishedAt,
    durationMs: typeof safe.durationMs === 'number' ? safe.durationMs : undefined,
    targetProfileId: safe.targetProfileId,
    targetAlias: safe.targetAlias,
    targetHost: safe.targetHost,
    resultSummary: safe.resultSummary,
    errorCode: safe.errorCode,
    sanitizedErrorMessage: safe.sanitizedErrorMessage,
  };
}

async function loadPersistedTasks(): Promise<SafeTask[]> {
  if (typeof window !== 'undefined' && window.helloMisterDesktop?.loadTaskLogs) return window.helloMisterDesktop.loadTaskLogs();
  if (typeof window !== 'undefined') {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(browserTaskLogKey) || '[]');
      return Array.isArray(parsed) ? parsed.map(sanitizeTask).slice(0, maxTaskLogCount) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function savePersistedTasks(tasks: SafeTask[]) {
  const safeTasks = tasks.map(sanitizeTask).slice(0, maxTaskLogCount);
  if (typeof window !== 'undefined' && window.helloMisterDesktop?.saveTaskLogs) {
    await window.helloMisterDesktop.saveTaskLogs(safeTasks);
    return;
  }
  if (typeof window !== 'undefined') window.localStorage.setItem(browserTaskLogKey, JSON.stringify(safeTasks));
}

export class TaskQueueService {
  private tasks: SafeTask[] = [];
  private listeners = new Set<(tasks: SafeTask[]) => void>();
  private hydrated = false;

  constructor(initialTasks: SafeTask[] = []) {
    this.tasks = initialTasks.map(sanitizeTask).slice(0, maxTaskLogCount);
  }

  async hydrate() {
    if (this.hydrated) return this.list();
    this.hydrated = true;
    const persisted = await loadPersistedTasks();
    this.tasks = persisted.map(sanitizeTask).slice(0, maxTaskLogCount);
    this.emit();
    return this.list();
  }

  enqueue(task: SafeTask) {
    const now = new Date().toISOString();
    const next = sanitizeTask({
      ...task,
      createdAt: task.createdAt || now,
      startedAt: task.startedAt || now,
      logs: Array.isArray(task.logs) && task.logs.length ? task.logs : [{ at: now, message: '작업을 기록했습니다.' }],
    });
    this.tasks = [next, ...this.tasks].slice(0, maxTaskLogCount);
    this.emitAndPersist();
    return next;
  }

  updateStatus(taskId: string, status: TaskStatus, message: string, meta: Partial<SafeTask> = {}) {
    const now = new Date().toISOString();
    this.tasks = this.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const finished = terminalStatusPattern.test(status);
      const startedAt = task.startedAt || task.createdAt || now;
      return sanitizeTask({
        ...task,
        ...meta,
        status,
        finishedAt: finished ? now : task.finishedAt,
        completedAt: finished ? now : task.completedAt,
        durationMs: finished ? new Date(now).getTime() - new Date(startedAt).getTime() : task.durationMs,
        resultSummary: meta.resultSummary || message,
        sanitizedErrorMessage: meta.sanitizedErrorMessage || (failedStatusPattern.test(status) ? message : task.sanitizedErrorMessage),
        logs: [...task.logs, { at: now, message }],
      });
    });
    this.emitAndPersist();
  }

  list() {
    return [...this.tasks];
  }

  async clear() {
    this.tasks = [];
    this.emit();
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.clearTaskLogs) return window.helloMisterDesktop.clearTaskLogs();
    if (typeof window !== 'undefined') window.localStorage.removeItem(browserTaskLogKey);
    return { ok: true, message: '작업 로그를 비웠습니다.' };
  }

  async exportLogs() {
    const safeTasks = this.tasks.map(sanitizeTask).slice(0, maxTaskLogCount);
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.exportTaskLogs) return window.helloMisterDesktop.exportTaskLogs(safeTasks);
    return { ok: false, message: '현재 환경에서는 작업 로그 파일 내보내기를 지원하지 않습니다.' };
  }

  subscribe(listener: (tasks: SafeTask[]) => void) {
    this.listeners.add(listener);
    listener(this.list());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const listener of this.listeners) listener(this.list());
  }

  private emitAndPersist() {
    this.emit();
    void savePersistedTasks(this.tasks).catch((error) => {
      console.warn('[Hello Mister] task log persistence failed:', error);
    });
  }
}

export const taskQueue = new TaskQueueService();

export function createTaskId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
