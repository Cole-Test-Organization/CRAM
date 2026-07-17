import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('opportunity pagination', () => {
  it('loads every API page without exceeding the route limit', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({ id: index + 1 }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString(), 'http://localhost');
      const offset = Number(url.searchParams.get('offset') || 0);
      const opportunities = offset === 0 ? firstPage : [{ id: 501 }];
      return new Response(JSON.stringify({ opportunities, total: 501 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getAllOpportunities({ sort: 'created_at', order: 'desc' });

    expect(result.opportunities).toHaveLength(501);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      '/api/opportunities?sort=created_at&order=desc&limit=500',
    );
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      '/api/opportunities?sort=created_at&order=desc&limit=500&offset=500',
    );
  });
});
