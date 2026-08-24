import { useEffect, useState } from 'react';
import type { SafeTask } from '../../types/tasks';
import { taskQueue } from './taskQueue';

export function useTaskQueue() {
  const [tasks, setTasks] = useState<SafeTask[]>(() => taskQueue.list());

  useEffect(() => {
    void taskQueue.hydrate();
    return taskQueue.subscribe(setTasks);
  }, []);

  return { tasks, taskQueue };
}
