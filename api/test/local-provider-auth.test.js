import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  listModels,
  ollamaChat,
  streamTurn,
} from '../src/agent/providers/local.js';

test('local provider forwards only the per-user API key as a Bearer token', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvKey = process.env.LOCAL_API_KEY;
  const requests = [];

  process.env.LOCAL_API_KEY = 'legacy-env-key-must-not-be-used';
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, authorization: new Headers(init.headers).get('authorization') });

    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'secure-model' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/api/chat')) {
      return new Response(JSON.stringify({ message: { content: 'ok' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/v1/chat/completions')) {
      return new Response(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    assert.deepEqual(
      await listModels('https://models-auth.test', 'models-secret'),
      ['secure-model'],
    );
    assert.equal(
      await ollamaChat({
        model: 'secure-model',
        messages: [{ role: 'user', content: 'hello' }],
        providerConfig: { baseUrl: 'https://native-auth.test', apiKey: 'native-secret' },
      }),
      'ok',
    );
    const turn = await streamTurn({
      model: 'secure-model',
      messages: [{ role: 'user', content: 'hello' }],
      mcpTools: [],
      providerConfig: { baseUrl: 'https://stream-auth.test', apiKey: 'stream-secret' },
    });
    assert.equal(turn?.content[0]?.text, 'ok');

    // LOCAL_API_KEY is intentionally ignored; bearer credentials come only
    // from the encrypted per-user setting passed through providerConfig.
    await ollamaChat({
      model: 'secure-model',
      messages: [{ role: 'user', content: 'hello' }],
      providerConfig: { baseUrl: 'https://no-auth.test' },
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnvKey === undefined) delete process.env.LOCAL_API_KEY;
    else process.env.LOCAL_API_KEY = originalEnvKey;
  }

  assert.deepEqual(
    requests.map(({ authorization }) => authorization),
    ['Bearer models-secret', 'Bearer native-secret', 'Bearer stream-secret', null],
  );
});
