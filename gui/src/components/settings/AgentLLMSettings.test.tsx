import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentLLMSettings from './AgentLLMSettings';

const apiMock = vi.hoisted(() => ({
  getAgentSettings: vi.fn(),
  patchAgentSettings: vi.fn(),
}));

vi.mock('../../lib/api', () => ({ api: apiMock }));

const SAVED_SETTINGS = {
  provider: 'local',
  model: 'secure-model',
  local_base_url: 'http://llama.test:8080',
  has_local_api_key: true,
  system_prompt: null,
  default_system_prompt: 'default',
  updated_at: '2026-07-17T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getAgentSettings.mockResolvedValue(SAVED_SETTINGS);
  apiMock.patchAgentSettings.mockResolvedValue(SAVED_SETTINGS);
});

describe('AgentLLMSettings bearer token', () => {
  it('keeps a saved write-only token when the password field is untouched', async () => {
    render(() => <AgentLLMSettings />);

    const input = await screen.findByLabelText('API key / bearer token');
    expect((input as HTMLInputElement).type).toBe('password');
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/encrypted token is saved/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiMock.patchAgentSettings).toHaveBeenCalledTimes(1));
    expect(apiMock.patchAgentSettings.mock.calls[0][0]).not.toHaveProperty('local_api_key');
  });

  it('saves a replacement or explicit clear without ever displaying plaintext', async () => {
    render(() => <AgentLLMSettings />);

    const input = await screen.findByLabelText('API key / bearer token');
    fireEvent.input(input, { target: { value: 'new-secret-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(apiMock.patchAgentSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ local_api_key: 'new-secret-token' }),
      ),
    );
    expect(screen.queryByText('new-secret-token')).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Clear token' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(apiMock.patchAgentSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ local_api_key: null }),
      ),
    );
  });
});
