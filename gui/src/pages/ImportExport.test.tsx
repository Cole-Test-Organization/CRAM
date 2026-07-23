import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImportExport from './ImportExport';

const apiMock = vi.hoisted(() => ({
  getAccounts: vi.fn<() => Promise<any>>(),
  exportDriveBundle: vi.fn<() => Promise<any>>(),
  exportBundle: vi.fn<() => Promise<any>>(),
}));
const downloadBlobMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/api', () => ({ api: apiMock }));
vi.mock('../lib/textExport', () => ({ downloadBlob: downloadBlobMock }));

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getAccounts.mockResolvedValue({
    accounts: [
      { slug: 'acme-manufacturing', name: 'Acme Manufacturing', status: 'account' },
      { slug: 'riverstone-health', name: 'Riverstone Health System', status: 'account' },
      { slug: 'cdw', name: 'CDW', status: 'partner' },
    ],
    total: 3,
  });
});

describe('ImportExport account bundles', () => {
  it('uses the shared account selection to download one Drive archive for multiple accounts', async () => {
    const archive = new Blob(['zip bytes'], { type: 'application/zip' });
    apiMock.exportDriveBundle.mockResolvedValue({
      blob: archive,
      filename: 'accounts-google-drive-2026-07-21.zip',
    });

    const history = createMemoryHistory();
    history.set({ value: '/import-export' });
    render(() => (
      <MemoryRouter history={history}>
        <Route path="/import-export" component={ImportExport} />
      </MemoryRouter>
    ));

    fireEvent.click(await screen.findByRole('checkbox', { name: /Acme Manufacturing/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Riverstone Health System/i }));

    const driveButton = screen.getByRole('button', { name: 'Export 2 for Drive' });
    const jsonButton = screen.getByRole('button', { name: 'Export 2 as JSON' });
    expect(driveButton.className).toContain('w-full');
    expect(driveButton.className).toContain('md:w-auto');
    expect(jsonButton.className).toContain('w-full');

    fireEvent.click(driveButton);

    await waitFor(() => {
      expect(apiMock.exportDriveBundle).toHaveBeenCalledWith([
        'acme-manufacturing',
        'riverstone-health',
      ]);
      expect(downloadBlobMock).toHaveBeenCalledWith(
        archive,
        'accounts-google-drive-2026-07-21.zip',
      );
    });
    expect(apiMock.exportBundle).not.toHaveBeenCalled();
  });
});
