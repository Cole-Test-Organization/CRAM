import { render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BrokerSecrets from './BrokerSecrets';

const apiMock = vi.hoisted(() => ({
  listProvisioningSecrets: vi.fn(),
  listProvisioningDeployments: vi.fn(),
  getProvisioningDeployment: vi.fn(),
  setProvisioningSecret: vi.fn(),
}));

vi.mock('../lib/api', () => ({ api: apiMock }));
vi.mock('./BrokerTabs', () => ({ default: () => <div data-testid="broker-tabs" /> }));

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.listProvisioningSecrets.mockResolvedValue([
    {
      name: 'PANW_NGFW_AUTH_CODE',
      description: 'Readable auth code',
      updatedAt: '2026-06-24T00:00:00.000Z',
      readable: true,
      value: 'readable-auth-code',
    },
    {
      name: 'PANW_DEVICE_CERT_PIN_VALUE',
      description: 'Still write-only',
      updatedAt: '2026-06-24T00:00:00.000Z',
      readable: false,
      valueSuffix: 'alue',
    },
  ]);
  apiMock.listProvisioningDeployments.mockResolvedValue([
    { id: 'aws-lab' },
  ]);
  apiMock.getProvisioningDeployment.mockResolvedValue({
    id: 'aws-lab',
    requiredEnv: ['PANW_NGFW_AUTH_CODE', 'PANW_DEVICE_CERT_PIN_VALUE'],
  });
});

describe('BrokerSecrets readable values', () => {
  it('renders allowlisted values and keeps other stored values hidden', async () => {
    render(() => <BrokerSecrets />);

    expect(await screen.findByText('readable-auth-code')).toBeTruthy();
    expect(screen.getByText('Readable')).toBeTruthy();
    expect(screen.getByText('****alue')).toBeTruthy();
    expect(screen.queryByText('hidden-pin-value')).toBeNull();
    expect(screen.getByText('Still write-only')).toBeTruthy();
  });
});
