import assert from 'node:assert/strict';
import test from 'node:test';

import { TodoistService } from '../src/services/todoist/todoist.ts';

test('TodoistService loads the bundled Todoist module from the repository root', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TODOIST_API_TOKEN;

  process.env.TODOIST_API_TOKEN = 'test-token';
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.todoist.com/api/v1/tasks');
    assert.equal(options.method, 'GET');
    return new Response(JSON.stringify({
      results: [{ id: 'task-1', content: 'Migration check' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.TODOIST_API_TOKEN;
    else process.env.TODOIST_API_TOKEN = originalToken;
  });

  const service = new TodoistService();
  assert.deepEqual(await service.getTasks(), [
    { id: 'task-1', content: 'Migration check' },
  ]);
});
