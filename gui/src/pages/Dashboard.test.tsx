import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';

const apiMock = vi.hoisted(() => ({
  health: vi.fn<() => Promise<any>>(),
  getAllMeetings: vi.fn<() => Promise<any>>(),
  getAccounts: vi.fn<() => Promise<any>>(),
  search: vi.fn<() => Promise<any>>(),
}));

vi.mock('../lib/api', () => ({ api: apiMock }));

beforeEach(() => {
  vi.clearAllMocks();
  const error = new Error('The configured CRAM server could not be reached.');
  apiMock.health.mockRejectedValue(error);
  apiMock.getAllMeetings.mockRejectedValue(error);
  apiMock.getAccounts.mockRejectedValue(error);
  apiMock.search.mockResolvedValue(null);
});

describe('Dashboard connection failures', () => {
  it('shows an actionable failure instead of leaving every panel loading forever', async () => {
    const history = createMemoryHistory();
    history.set({ value: '/' });
    render(() => (
      <MemoryRouter history={history}>
        <Route path="/" component={Dashboard} />
      </MemoryRouter>
    ));

    expect(await screen.findByText('CRAM could not reach its data service.')).toBeTruthy();
    expect(screen.getByText('Could not load recent meetings.')).toBeTruthy();
    expect(screen.getByText('Could not load accounts.')).toBeTruthy();
    expect(screen.getByText('Could not load partners.')).toBeTruthy();
    expect(screen.queryByText('Loading...')).toBeNull();
  });
});
