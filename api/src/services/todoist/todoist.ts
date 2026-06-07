// TODO: Add authentication for production/remote access

import { createRequire } from 'module';
import path from 'path';

// Import todoist API functions from the todoist module
const require = createRequire(path.resolve(import.meta.dirname, '..', '..', '..', 'todoist', 'package.json'));

// The todoist module is dynamically imported (ESM, resolved at call time), so
// its shape isn't statically known here — `any` is the honest type for the
// lazily-loaded namespace.
let todoistApi: any = null;

async function getTodoistApi() {
  if (todoistApi) return todoistApi;
  // Dynamic import since todoist module uses ESM
  todoistApi = await import(path.resolve(import.meta.dirname, '..', '..', '..', 'todoist', 'src', 'api.js'));
  return todoistApi;
}

export class TodoistService {
  async createTask(data: Record<string, unknown>) {
    const api = await getTodoistApi();
    return api.createTask(data);
  }

  async createTasksBatch(tasks: Array<Record<string, unknown>>) {
    const api = await getTodoistApi();
    const results = [];
    for (const task of tasks) {
      const result = await api.createTask(task);
      results.push(result);
    }
    return results;
  }

  async getTasks({ label, filter }: { label?: string; filter?: string } = {}) {
    const api = await getTodoistApi();
    return api.getTasks({ label, filter });
  }

  async closeTask(taskId: string) {
    const api = await getTodoistApi();
    return api.closeTask(taskId);
  }
}
