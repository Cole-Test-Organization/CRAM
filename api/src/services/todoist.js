// TODO: Add authentication for production/remote access

import { createRequire } from 'module';
import path from 'path';

// Import todoist API functions from the todoist module
const require = createRequire(path.resolve(import.meta.dirname, '..', '..', '..', 'todoist', 'package.json'));

let todoistApi = null;

async function getTodoistApi() {
  if (todoistApi) return todoistApi;
  // Dynamic import since todoist module uses ESM
  todoistApi = await import(path.resolve(import.meta.dirname, '..', '..', '..', 'todoist', 'src', 'api.js'));
  return todoistApi;
}

export class TodoistService {
  async createTask(data) {
    const api = await getTodoistApi();
    return api.createTask(data);
  }

  async createTasksBatch(tasks) {
    const api = await getTodoistApi();
    const results = [];
    for (const task of tasks) {
      const result = await api.createTask(task);
      results.push(result);
    }
    return results;
  }

  async getTasks({ label, filter } = {}) {
    const api = await getTodoistApi();
    return api.getTasks({ label, filter });
  }

  async closeTask(taskId) {
    const api = await getTodoistApi();
    return api.closeTask(taskId);
  }
}
