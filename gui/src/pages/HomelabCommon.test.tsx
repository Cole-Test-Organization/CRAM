import { render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { ProvisioningJob, ProvisioningRdpTunnel, ProvisioningResource } from '../lib/api';
import JobMonitor from '../components/provisioning/JobMonitor';
import { RdpTunnelEndpoint, ResourceConnections, resourceConnections } from './HomelabCommon';

function job(overrides: Partial<ProvisioningJob> = {}): ProvisioningJob {
  return {
    id: 'job-live',
    action: 'deploy',
    target: null,
    deployment: 'aws-lab',
    resourceAction: null,
    status: 'running',
    cancelRequested: false,
    params: null,
    error: null,
    createdAt: '2026-06-19T21:00:00.000Z',
    startedAt: '2026-06-19T21:00:05.000Z',
    finishedAt: null,
    logs: ['terraform apply started'],
    ...overrides,
  };
}

describe('JobMonitor live updates', () => {
  it('renders streamed job status and log updates without waiting for polling', async () => {
    const [liveJob, setLiveJob] = createSignal(job());

    render(() => (
      <JobMonitor
        jobId="job-live"
        liveConnected
        liveJob={liveJob()}
      />
    ));

    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByText(/terraform apply started/)).toBeTruthy();

    setLiveJob(job({
      finishedAt: '2026-06-19T21:01:00.000Z',
      logs: ['terraform apply started', 'deployment ready'],
      status: 'succeeded',
    }));

    expect(await screen.findByText('succeeded')).toBeTruthy();
    expect(screen.getByText(/deployment ready/)).toBeTruthy();
  });
});

function resourceWithOutputs(outputs: Record<string, unknown> | null): ProvisioningResource {
  return {
    id: 'r1',
    deploymentId: 'd1',
    name: null,
    hostname: 'host-1',
    kind: 'ubuntu-server',
    lifecycleStatus: 'ready',
    configPath: 'cfg',
    provider: 'aws',
    vmId: null,
    providerResourceId: 'i-0abc',
    terraformStatePath: null,
    outputs,
    lastJobId: null,
    powerState: 'running',
    powerStateCheckedAt: null,
    updatedAt: '2026-06-20T00:00:00.000Z',
  };
}

function rdpTunnel(overrides: Partial<ProvisioningRdpTunnel> = {}): ProvisioningRdpTunnel {
  return {
    id: 'rdp_host-1',
    resourceId: 'r1',
    hostname: 'host-1',
    providerResourceId: 'i-0abc',
    status: 'running',
    bindAddress: '0.0.0.0',
    advertisedHost: '172.20.10.9',
    publicPort: 13389,
    internalPort: 23389,
    remotePort: 3389,
    rdpEndpoint: '172.20.10.9:13389',
    username: 'Admin',
    startedAt: '2026-06-20T00:00:00.000Z',
    expiresAt: null,
    closedAt: null,
    closeReason: null,
    logs: [],
    ...overrides,
  };
}

describe('resourceConnections', () => {
  it('returns nothing when there are no outputs', () => {
    expect(resourceConnections({ outputs: null })).toEqual([]);
    expect(resourceConnections({ outputs: {} })).toEqual([]);
  });

  // The extractor must work the same across every resource kind/provider without
  // branching on provider — these are the real Terraform output shapes.
  it('extracts public and private IPs from an ubuntu-server, ignoring non-address fields', () => {
    const endpoints = resourceConnections({
      outputs: {
        server: {
          hostname: 'gp-ubuntu',
          instance_id: 'i-0abc123',
          ami_id: 'ami-1',
          private_ip: '10.0.1.20',
          public_ip: '54.1.2.3',
          ssh_command: 'ssh ubuntu@54.1.2.3',
          bootstrap_log: '/var/log/panw-broker-bootstrap.log',
        },
      },
    });

    expect(endpoints).toEqual([
      { label: 'Public IP', address: '54.1.2.3', family: 'ipv4', scope: 'public', href: null, primary: true },
      { label: 'Private IP', address: '10.0.1.20', family: 'ipv4', scope: 'private', href: null, primary: false },
    ]);
  });

  it('handles a windows-endpoint with a null public_ip (private only, no primary)', () => {
    const endpoints = resourceConnections({
      outputs: {
        endpoint: {
          instance_id: 'i-0def456',
          private_ip: '10.0.2.30',
          public_ip: null,
          rdp_username: 'Admin',
          bootstrap_log: 'C:\\ProgramData\\panw-broker\\bootstrap.log',
        },
      },
    });

    expect(endpoints).toEqual([
      { label: 'Private IP', address: '10.0.2.30', family: 'ipv4', scope: 'private', href: null, primary: false },
    ]);
  });

  it('orders firewall addresses public-IP → URL → private-IP and marks the first public IP primary', () => {
    const endpoints = resourceConnections({
      outputs: {
        firewall: {
          instance_id: 'i-1',
          management_public: '52.10.0.5',
          management_ip: '10.0.0.10',
          untrust_public: '52.10.0.6',
          untrust_ip: '10.0.1.10',
          trust_ip: '10.0.2.10',
          https_url: 'https://52.10.0.5',
          ssh_command: 'ssh -i <path-to-private-key> admin@52.10.0.5',
        },
      },
    });

    expect(endpoints.map((e) => [e.label, e.scope, e.family])).toEqual([
      ['Management Public', 'public', 'ipv4'],
      ['Untrust Public', 'public', 'ipv4'],
      ['HTTPS URL', 'public', 'url'],
      ['Management IP', 'private', 'ipv4'],
      ['Untrust IP', 'private', 'ipv4'],
      ['Trust IP', 'private', 'ipv4'],
    ]);
    expect(endpoints.find((e) => e.primary)?.label).toBe('Management Public');
    expect(endpoints.find((e) => e.family === 'url')?.href).toBe('https://52.10.0.5');
  });

  it('extracts management URLs from EKS app outputs and excludes schemeless hosts/registries', () => {
    const endpoints = resourceConnections({
      outputs: {
        eks: {
          cluster_name: 'gp',
          endpoint: 'https://ABC123.eks.amazonaws.com',
          ecr_repository_url: '1234.dkr.ecr.us-east-1.amazonaws.com/app',
          vpc_id: 'vpc-1',
          public_subnet_ids: ['subnet-1', 'subnet-2'],
        },
        app: {
          url: 'http://a-elb.amazonaws.com',
          health_url: 'http://a-elb.amazonaws.com/health',
          service_hostname: 'a-elb.amazonaws.com',
        },
      },
    });

    expect(endpoints.map((e) => e.address)).toEqual([
      'https://ABC123.eks.amazonaws.com',
      'http://a-elb.amazonaws.com',
      'http://a-elb.amazonaws.com/health',
    ]);
    expect(endpoints.every((e) => e.family === 'url')).toBe(true);
    expect(endpoints.find((e) => e.primary)?.address).toBe('https://ABC123.eks.amazonaws.com');
  });

  it('dedupes a repeated address', () => {
    const endpoints = resourceConnections({
      outputs: { a: { mgmt: '10.0.0.5' }, b: { same: '10.0.0.5' } },
    });
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].address).toBe('10.0.0.5');
  });
});

describe('ResourceConnections component', () => {
  it('renders copyable IPs and a clickable link for URL endpoints', () => {
    render(() => (
      <ResourceConnections
        resource={resourceWithOutputs({
          panorama: { mgmt_public: '52.20.0.7', mgmt_private: '10.0.0.20', https_url: 'https://52.20.0.7' },
        })}
      />
    ));

    expect(screen.getByText('52.20.0.7')).toBeTruthy();
    expect(screen.getByText('10.0.0.20')).toBeTruthy();
    const link = screen.getByText('https://52.20.0.7') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://52.20.0.7');
  });

  it('renders nothing when the resource has no addresses', () => {
    const { container } = render(() => <ResourceConnections resource={resourceWithOutputs({ server: { instance_id: 'i-9' } })} />);
    expect(container.textContent).toBe('');
  });
});

describe('RdpTunnelEndpoint component', () => {
  it('renders the broker RDP endpoint and username for an active tunnel', () => {
    render(() => <RdpTunnelEndpoint tunnel={rdpTunnel()} />);

    expect(screen.getByText('Broker RDP')).toBeTruthy();
    expect(screen.getByText('172.20.10.9:13389')).toBeTruthy();
    expect(screen.getByText('Username')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
  });

  it('renders nothing for a closed tunnel', () => {
    const { container } = render(() => <RdpTunnelEndpoint tunnel={rdpTunnel({ status: 'closed' })} />);
    expect(container.textContent).toBe('');
  });
});
