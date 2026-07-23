import { render, screen } from '@solidjs/testing-library';
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountDetail from './AccountDetail';

const apiMock = vi.hoisted(() => ({
  getAccount: vi.fn<() => Promise<any>>(),
  patchAccount: vi.fn<() => Promise<any>>(),
  accountDriveExportUrl: vi.fn((slug: string) => `/api/export/accounts/${encodeURIComponent(slug)}`),
  exportAccountBundle: vi.fn<() => Promise<any>>(),
}));

vi.mock('../lib/api', () => ({ api: apiMock }));

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getAccount.mockResolvedValue({
    id: 7,
    slug: 'acme-manufacturing',
    name: 'Acme Manufacturing',
    status: 'account',
    last_contact: null,
    relationship_summary: '',
    domains: [],
    partners: [],
    contacts: [],
    team: [],
    meetings: [{ id: 11 }],
    opportunities: [],
    open_thread_count: 0,
  });
});

describe('AccountDetail exports', () => {
  it('renders a mobile-available Drive folder download with the account slug', async () => {
    const history = createMemoryHistory();
    history.set({ value: '/accounts/acme-manufacturing' });

    render(() => (
      <MemoryRouter history={history}>
        <Route path="/accounts/:slug" component={AccountDetail} />
      </MemoryRouter>
    ));

    const link = await screen.findByRole('link', { name: 'Export for Drive' });
    expect(link.getAttribute('href')).toBe('/api/export/accounts/acme-manufacturing');
    expect(link.getAttribute('download')).toBe('acme-manufacturing-google-drive.zip');
    expect(link.className).toContain('press-sm');
    expect(link.parentElement?.className).toContain('flex-wrap');
    expect(link.className).not.toContain('hidden');
  });
});
